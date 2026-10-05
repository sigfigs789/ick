-- (Numbered 20261005000000: 20261001010000 is copy_report_since, the last on main.)
--
-- Who comes back, for the bottom of /analytics. The rest of the page splits
-- retention by the calendar and by mode; this splits it by what a player went
-- through, which is the question the calendar cannot answer. Four parts:
--
--   firstPuzzle  each new player's first puzzle, split by something that
--                happened on it, against whether they came back.
--   puzzles      next-day return per puzzle, beside how that puzzle played.
--   lastDay      the last day of the players who stopped, against their own
--                earlier days.
--   versions     next-day return by the build the player was on.
--
-- Plays are the leaderboard's rows, as in analytics_report, so the play splits
-- (mode, score, words) cover everybody. Everything else is the event log joined
-- by `player_id` and the puzzle the event names. The iOS app and the Reddit post
-- report no events at all, so their days are counted as untracked and kept out
-- of every event split -- `tracked` and `untracked` say how many that is.
--
-- The page is open without a key, and the rule there is that no number is
-- taken over fewer people than a day's players. A split of first-timers can be
-- far smaller than that, so a group of fewer than five players is left out
-- here, before anything leaves the database, and the same floor stands on every
-- other group below.
--
-- The window is analytics_report's: `p_days` puzzles ending on `p_date` (or on
-- the latest anybody played). A part is about the players whose first puzzle,
-- puzzle, or last puzzle falls in it.

create or replace function public.retention_report(p_days integer default 60, p_date date default null)
returns jsonb
language sql
stable
as $$
  with
  days as (
    select case when p_date is not null and p_days between 1 and 365 then p_days
      when p_days = 1 then 1 else greatest(7, least(coalesce(p_days, 60), 365)) end as n
  ),
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  plays as (
    select
      s.player_id::text as player_id,
      s.puzzle_date,
      s.words,
      s.top_score::numeric as top_score,
      case
        when s.mode in ('standard', 'freeform') then s.mode
        when s.puzzle_date >= date '2026-09-14' and s.puzzle_date < date '2026-09-27' then 'freeform'
        else 'standard'
      end as mode
    from public.leaderboard_scores s
    where not exists (select 1 from github_players g where g.player_id = s.player_id::text)
  ),
  -- One row per player per puzzle, both modes together: a day is one visit to
  -- the game whichever rules it was played under.
  player_days as (
    select
      player_id,
      puzzle_date,
      sum(words) as words,
      max(top_score) as top_score,
      case when count(distinct mode) > 1 then 'both' else min(mode) end as mode
    from plays
    group by player_id, puzzle_date
  ),
  firsts as (
    select player_id, min(puzzle_date) as first_day, max(puzzle_date) as last_day, count(*) as days_played
    from player_days
    group by player_id
  ),
  bounds as (
    select max(puzzle_date) as as_of, coalesce(p_date, max(puzzle_date)) as win_end
    from player_days
  ),
  win as (
    select
      greatest(b.win_end - (days.n - 1), (select min(puzzle_date) from player_days)) as win_start,
      b.win_end,
      b.as_of
    from bounds b, days
  ),

  -- Every event that names a player, with the puzzle it names read safely: the
  -- endpoint is public, and one malformed row must not take the report down.
  ev as (
    select
      e.name,
      e.props,
      e.created_at,
      e.props ->> 'player_id' as player_id,
      case when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date end as puzzle_date
    from public.analytics_events e
    where e.name in ('puzzle_completed', 'answer_accepted', 'rejection_message_shown',
                     'base_form_substituted', 'answer_retried', 'answer_revealed',
                     'leaderboard_opened', 'found_words_opened', 'result_copied',
                     'result_shared_on_x', 'chat_opened', 'session_time', 'site_visit')
      and e.props ->> 'player_id' is not null
      and not exists (select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  -- What happened on each player's puzzle, as far as the events say.
  day_events as (
    select
      player_id,
      puzzle_date,
      bool_or(name = 'puzzle_completed') as completed,
      bool_or(name = 'puzzle_completed' and props ->> 'won' = 'true') as won,
      count(*) filter (where name = 'rejection_message_shown') as refusals,
      bool_or(name = 'rejection_message_shown' and props ->> 'rejection_reason' = 'misspelling') as r_misspelling,
      bool_or(name = 'rejection_message_shown' and props ->> 'rejection_reason' = 'not-a-word') as r_not_a_word,
      bool_or(name = 'rejection_message_shown'
              and props ->> 'rejection_reason' in ('obsolete', 'archaic', 'dated')) as r_old,
      bool_or(name = 'rejection_message_shown'
              and props ->> 'rejection_reason' in ('proper-noun', 'abbreviation', 'name-or-abbreviation')) as r_name,
      bool_or(name = 'rejection_message_shown'
              and props ->> 'rejection_reason' in ('missing-drop', 'same-as-drop', 'already-used', 'empty')) as r_rules,
      -- Every one of these is a word that scored lower than its own frequency
      -- would have given it (see baseFormSubstitution).
      count(*) filter (where name = 'base_form_substituted') as folds,
      bool_or(name = 'answer_retried') as retried,
      bool_or(name = 'answer_revealed') as revealed,
      bool_or(name in ('leaderboard_opened', 'found_words_opened')) as looked,
      bool_or(name in ('result_copied', 'result_shared_on_x')) as shared,
      bool_or(name = 'chat_opened') as chatted
    from ev
    where puzzle_date is not null
    group by player_id, puzzle_date
  ),
  -- Sessions report more than once; each is taken at its largest totals, and a
  -- day's are summed (visible time) or taken at the earliest (first guess).
  sessions as (
    select
      player_id,
      puzzle_date,
      props ->> 'session_id' as session_id,
      max(case when jsonb_typeof(props -> 'visible_ms') = 'number'
            then (props ->> 'visible_ms')::numeric end) as visible_ms,
      max(case when jsonb_typeof(props -> 'time_to_first_guess_ms') = 'number'
            then (props ->> 'time_to_first_guess_ms')::numeric end) as first_guess_ms
    from ev
    where name = 'session_time' and puzzle_date is not null and props ? 'session_id'
    group by 1, 2, 3
  ),
  day_sessions as (
    select player_id, puzzle_date, sum(visible_ms) as visible_ms, min(first_guess_ms) as first_guess_ms
    from sessions
    group by 1, 2
  ),
  -- First touch is sticky on the client (see visits.ts), so the earliest visit
  -- that names a source names the player's.
  arrivals as (
    select distinct on (player_id) player_id, props ->> 'source' as source
    from ev
    where name = 'site_visit' and coalesce(props ->> 'source', '') <> ''
    order by player_id, created_at
  ),
  -- The build each player-day ran. Visits carry the puzzle from 2026-09-30;
  -- before that, the calendar day the visit arrived on in Mountain Time.
  day_versions as (
    select
      player_id,
      coalesce(puzzle_date, (created_at at time zone 'America/Denver')::date) as puzzle_date,
      max((props ->> 'app_version')::int) as version
    from ev
    where name = 'site_visit' and jsonb_typeof(props -> 'app_version') = 'number'
      and props ->> 'app_version' ~ '^[0-9]{1,6}$'
    group by 1, 2
  ),

  facts as (
    select
      d.player_id,
      d.puzzle_date,
      d.words,
      d.top_score,
      d.mode,
      f.first_day,
      f.last_day,
      f.days_played,
      de.player_id is not null as tracked,
      coalesce(de.completed, false) as completed,
      coalesce(de.won, false) as won,
      coalesce(de.refusals, 0) as refusals,
      coalesce(de.r_misspelling, false) as r_misspelling,
      coalesce(de.r_not_a_word, false) as r_not_a_word,
      coalesce(de.r_old, false) as r_old,
      coalesce(de.r_name, false) as r_name,
      coalesce(de.r_rules, false) as r_rules,
      coalesce(de.folds, 0) as folds,
      coalesce(de.retried, false) as retried,
      coalesce(de.revealed, false) as revealed,
      coalesce(de.looked, false) as looked,
      coalesce(de.shared, false) as shared,
      coalesce(de.chatted, false) as chatted,
      ds.visible_ms,
      ds.first_guess_ms,
      a.source,
      v.version,
      coalesce(d.next_day = d.puzzle_date + 1, false) as returned_next,
      coalesce(d.next_day <= d.puzzle_date + 7, false) as returned_week,
      coalesce(d.prev_day = d.puzzle_date - 1, false) as played_day_before
    from (
      -- Each day's neighbours, which is all "came back" and "came after a gap" ask.
      select pd.*,
        lead(pd.puzzle_date) over (partition by pd.player_id order by pd.puzzle_date) as next_day,
        lag(pd.puzzle_date) over (partition by pd.player_id order by pd.puzzle_date) as prev_day
      from player_days pd
    ) d
      join firsts f on f.player_id = d.player_id
      left join day_events de on de.player_id = d.player_id and de.puzzle_date = d.puzzle_date
      left join day_sessions ds on ds.player_id = d.player_id and ds.puzzle_date = d.puzzle_date
      left join arrivals a on a.player_id = d.player_id
      left join day_versions v on v.player_id = d.player_id and v.puzzle_date = d.puzzle_date
  ),

  -- Part 1. New players in the window, at their first puzzle.
  first_rows as (
    select x.*
    from facts x, win w
    where x.puzzle_date = x.first_day and x.first_day between w.win_start and w.win_end
  ),
  -- Each split as (split, order, group) per player. A null group is a player
  -- the split cannot place -- untracked, or a session never reported -- and is
  -- left out of that split only.
  first_groups as (
    select 'mode' as split, case mode when 'standard' then 1 when 'freeform' then 2 else 3 end as ord,
      case mode when 'standard' then 'Standard' when 'freeform' then 'Freeform' else 'Both modes' end as grp, *
    from first_rows
    union all
    select 'score', case when top_score >= 9 then 1 when top_score >= 7 then 2 when top_score >= 5 then 3 else 4 end,
      case when top_score >= 9 then '9 or more' when top_score >= 7 then '7 to 9'
           when top_score >= 5 then '5 to 7' else 'Under 5' end, *
    from first_rows
    union all
    select 'words', least(words, 4)::int,
      case when words >= 4 then '4 or more' else words::text end, *
    from first_rows
    union all
    select 'outcome', case when won then 1 when completed then 2 else 3 end,
      case when won then 'Won' when completed then 'Finished, no win' else 'Left before finishing' end, *
    from first_rows where tracked
    union all
    select 'refusals', least(refusals, 2)::int + 1,
      case when refusals = 0 then 'None' when refusals = 1 then '1' else '2 or more' end, *
    from first_rows where tracked
    -- The reasons overlap: a player refused for two reasons is in both rows.
    union all
    select 'reason', 1, 'Misspelling', * from first_rows where tracked and r_misspelling
    union all
    select 'reason', 2, 'Not a word', * from first_rows where tracked and r_not_a_word
    union all
    select 'reason', 3, 'Obsolete, archaic or dated', * from first_rows where tracked and r_old
    union all
    select 'reason', 4, 'Name or abbreviation', * from first_rows where tracked and r_name
    union all
    select 'reason', 5, 'Broke a rule (drop, repeat)', * from first_rows where tracked and r_rules
    union all
    select 'reason', 6, 'Never refused', * from first_rows where tracked and refusals = 0
    -- Freeform does not fold, so only a Standard-only first day can say.
    union all
    select 'fold', case when folds > 0 then 1 else 2 end,
      case when folds > 0 then 'A word scored as its common form' else 'No word scored down' end, *
    from first_rows where tracked and mode = 'standard'
    union all
    select 'retry', case when retried then 1 when revealed then 2 else 3 end,
      case when retried then 'Set a word aside' when revealed then 'Revealed the word' else 'Neither' end, *
    from first_rows where tracked
    union all
    select 'looked', case when looked then 1 else 2 end,
      case when looked then 'Opened the leaderboard or found words' else 'Did not' end, *
    from first_rows where tracked
    union all
    select 'shared', case when shared then 1 else 2 end,
      case when shared then 'Shared their result' else 'Did not' end, *
    from first_rows where tracked
    union all
    select 'chat', case when chatted then 1 else 2 end,
      case when chatted then 'Opened the chat' else 'Did not' end, *
    from first_rows where tracked
    union all
    select 'source', 0, coalesce(source, 'direct'), * from first_rows where tracked
    union all
    select 'firstGuess',
      case when first_guess_ms < 30000 then 1 when first_guess_ms < 120000 then 2 else 3 end,
      case when first_guess_ms < 30000 then 'Under 30 seconds' when first_guess_ms < 120000 then '30 seconds to 2 minutes'
           else 'Over 2 minutes' end, *
    from first_rows where tracked and first_guess_ms is not null
    union all
    select 'time',
      case when visible_ms < 60000 then 1 when visible_ms < 180000 then 2 when visible_ms < 600000 then 3 else 4 end,
      case when visible_ms < 60000 then 'Under 1 minute' when visible_ms < 180000 then '1 to 3 minutes'
           when visible_ms < 600000 then '3 to 10 minutes' else '10 minutes or more' end, *
    from first_rows where tracked and visible_ms is not null
  ),
  first_split as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'split', s.split,
      'group', s.grp,
      'players', s.players,
      'nextDay', jsonb_build_object('cohort', s.d1_cohort, 'returned', s.d1_returned),
      'week', jsonb_build_object('cohort', s.wk_cohort, 'returned', s.wk_returned)
    ) order by s.split, s.ord, s.players desc, s.grp), '[]'::jsonb) as v
    from (
      select
        g.split, g.ord, g.grp,
        count(*) as players,
        count(*) filter (where g.first_day < w.as_of) as d1_cohort,
        count(*) filter (where g.first_day < w.as_of and g.returned_next) as d1_returned,
        count(*) filter (where g.first_day + 7 < w.as_of) as wk_cohort,
        count(*) filter (where g.first_day + 7 < w.as_of and g.returned_week) as wk_returned
      from first_groups g, win w
      group by g.split, g.ord, g.grp
      having count(*) >= 5
    ) s
  ),
  first_totals as (
    select jsonb_build_object(
      'players', count(*),
      'tracked', count(*) filter (where tracked),
      'nextDay', jsonb_build_object(
        'cohort', count(*) filter (where first_day < w.as_of),
        'returned', count(*) filter (where first_day < w.as_of and returned_next)),
      'week', jsonb_build_object(
        'cohort', count(*) filter (where first_day + 7 < w.as_of),
        'returned', count(*) filter (where first_day + 7 < w.as_of and returned_week))
    ) as v
    from first_rows, win w
    group by w.as_of
  ),

  -- Part 2. Each puzzle in the window, and whether its players came back.
  -- The latest puzzle is still being played, so it has no next day yet.
  puzzles as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', p.puzzle_date,
      'players', p.players,
      'nextDay', jsonb_build_object('cohort', p.nd_cohort, 'returned', p.nd_returned),
      'newPlayers', p.new_players,
      -- New players are a subset of the day, so they keep the floor of five.
      'newNextDay', case when p.new_players >= 5
        then jsonb_build_object('cohort', p.new_cohort, 'returned', p.new_returned) end,
      'avgWords', p.avg_words,
      'avgTop', p.avg_top,
      'tracked', p.tracked,
      'completed', p.completed,
      'won', p.won,
      'refusalsPerPlayer', p.refusals_pp,
      'foldsPerPlayer', p.folds_pp
    ) order by p.puzzle_date desc), '[]'::jsonb) as v
    from (
      select
        x.puzzle_date,
        count(*) as players,
        count(*) filter (where x.puzzle_date < w.as_of) as nd_cohort,
        count(*) filter (where x.puzzle_date < w.as_of and x.returned_next) as nd_returned,
        count(*) filter (where x.puzzle_date = x.first_day) as new_players,
        count(*) filter (where x.puzzle_date = x.first_day and x.puzzle_date < w.as_of) as new_cohort,
        count(*) filter (where x.puzzle_date = x.first_day and x.puzzle_date < w.as_of and x.returned_next) as new_returned,
        round(avg(x.words), 2) as avg_words,
        round(avg(x.top_score), 2) as avg_top,
        count(*) filter (where x.tracked) as tracked,
        count(*) filter (where x.tracked and x.completed) as completed,
        count(*) filter (where x.tracked and x.won) as won,
        round(avg(x.refusals) filter (where x.tracked), 2) as refusals_pp,
        round(avg(x.folds) filter (where x.tracked and x.mode = 'standard'), 2) as folds_pp
      from facts x, win w
      where x.puzzle_date between w.win_start and w.win_end
      group by x.puzzle_date
      having count(*) >= 5
    ) p
  ),

  -- Part 3. Players who played three or more puzzles, the last of them in the
  -- window, and then missed at least the two after it that are over. Their last
  -- day against their own earlier days, so the comparison holds the players
  -- fixed. A gap they later came back from is not a stop and is not counted.
  stopped as (
    select f.player_id
    from firsts f, win w
    where f.days_played >= 3
      and f.last_day between w.win_start and w.win_end
      and f.last_day + 2 < w.as_of
  ),
  stop_rows as (
    select case when x.puzzle_date = x.last_day then 'last' else 'usual' end as kind, x.*
    from facts x
    join stopped s on s.player_id = x.player_id
  ),
  stop_stats as (
    select kind, jsonb_build_object(
      'days', count(*),
      'avgWords', round(avg(words), 2),
      'avgTop', round(avg(top_score), 2),
      'tracked', count(*) filter (where tracked),
      'finishShare', round(avg(case when completed then 1 else 0 end) filter (where tracked), 3),
      'winShare', round(avg(case when won then 1 else 0 end) filter (where tracked and completed), 3),
      'refusalsPerDay', round(avg(refusals) filter (where tracked), 2),
      'foldsPerDay', round(avg(folds) filter (where tracked and mode = 'standard'), 2),
      'revealedShare', round(avg(case when revealed then 1 else 0 end) filter (where tracked), 3),
      'lookedShare', round(avg(case when looked then 1 else 0 end) filter (where tracked), 3),
      'sharedShare', round(avg(case when shared then 1 else 0 end) filter (where tracked), 3),
      -- Came back from a missed puzzle that day, so any streak had already
      -- broken. A first day has no day before it and is not counted.
      'afterGapShare', round(avg(case when played_day_before then 0 else 1 end)
                             filter (where puzzle_date > first_day), 3),
      'freeformShare', round(avg(case when mode = 'freeform' then 1 else 0 end), 3)
    ) as v
    from stop_rows
    group by kind
  ),
  last_day as (
    select jsonb_build_object(
      'players', (select count(*) from stopped),
      'last', case when (select count(*) from stopped) >= 5
        then (select v from stop_stats where kind = 'last') end,
      'usual', case when (select count(*) from stopped) >= 5
        then (select v from stop_stats where kind = 'usual') end
    ) as v
  ),

  -- Part 4. Next-day return by the build a player-day ran, in the window.
  versions as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', r.version,
      'players', r.players,
      'firstDay', r.first_day,
      'lastDay', r.last_day,
      'nextDay', jsonb_build_object('cohort', r.nd_cohort, 'returned', r.nd_returned)
    ) order by r.version desc), '[]'::jsonb) as v
    from (
      select
        x.version,
        count(distinct x.player_id) as players,
        min(x.puzzle_date) as first_day,
        max(x.puzzle_date) as last_day,
        count(*) filter (where x.puzzle_date < w.as_of) as nd_cohort,
        count(*) filter (where x.puzzle_date < w.as_of and x.returned_next) as nd_returned
      from facts x, win w
      where x.version is not null and x.puzzle_date between w.win_start and w.win_end
      group by x.version
      having count(distinct x.player_id) >= 5
    ) r
  )

  select jsonb_build_object(
    'from', (select win_start from win),
    'to', (select win_end from win),
    -- The first puzzle any event named a player on: before it, every day is
    -- untracked whatever the device.
    'trackedSince', (select min(puzzle_date) from day_events),
    'firstPuzzle', jsonb_build_object(
      'totals', coalesce((select v from first_totals),
        '{"players":0,"tracked":0,"nextDay":{"cohort":0,"returned":0},"week":{"cohort":0,"returned":0}}'::jsonb),
      'groups', (select v from first_split)),
    'puzzles', (select v from puzzles),
    'lastDay', (select v from last_day),
    'versions', (select v from versions)
  );
$$;

comment on function public.retention_report(integer, date) is
  'Who comes back and what they went through, for the bottom of the /analytics page. Read by api/review.ts alongside analytics_report.';

-- Explicit, for the reason every recent migration gives: service_role does not
-- inherit what public is given, and a clean stack grants it nothing by default.
revoke all on function public.retention_report(integer, date) from public, anon, authenticated;
grant execute on function public.retention_report(integer, date) to service_role;
