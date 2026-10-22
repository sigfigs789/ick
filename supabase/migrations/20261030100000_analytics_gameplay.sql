-- The numbers /analyticsV2 needs that analytics_overview does not have: strict
-- day-N retention, and why players come back -- the leaderboard, sharing, and
-- the score they finished on.
--
-- A function of its own rather than another replace of analytics_overview,
-- which every analytics change has rewritten whole. Its players are the
-- overview's: everything from `muse_players` to `bounds` is copied from
-- 20261029100000_analytics_modes_both.sql unchanged, so the bots, the people
-- building the game and Muse are left out the same way, and a player's day is
-- the same day. A change to who is counted there wants making here as well.
--
--   retention    For D1, D7 and D30: the players whose first-ever day is in
--                the 28 days up to the last one whose day N is over, and how
--                many of them turned up on exactly that day.
--   leaderboard  The window's players, how many opened the leaderboard, and
--                the opens and days it took. Then, over the window's guessing
--                days whose next puzzle is over, the share back on the next
--                puzzle, split by whether the board was opened that day.
--   sharing      The same guessing days split by whether a result was shared
--                that day.
--   scores       The window's finished puzzles (puzzle_completed), a player's
--                day once, by the tier of the best word: how many, how many
--                were shared, and of those whose next puzzle is over, how many
--                came back for it.

create or replace function public.analytics_gameplay(
  p_from date default null,
  p_to date default null,
  p_today date default null
)
returns jsonb
language sql
stable
as $$
  with
  -- Muse AI's browsers: any that ever sent the tag.
  muse_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'visitor' = 'mos-muse'
      and e.props ->> 'player_id' is not null
  ),
  -- Each player's first site_visit: when, and on which puzzle (the same day
  -- rule as events, below).
  first_visits as (
    select
      e.props ->> 'player_id' as player_id,
      min(e.created_at) as at,
      min(case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end) as day
    from public.analytics_events e
    where e.name = 'site_visit'
      and e.props ->> 'player_id' is not null
    group by 1
  ),
  -- The gap to the nearest other first visit on either side, so a pair is
  -- found with one sort rather than a self-join.
  visit_gaps as (
    select
      player_id,
      day,
      at - lag(at) over (order by at) as gap_before,
      lead(at) over (order by at) - at as gap_after
    from first_visits
  ),
  -- Anyone who did something only a person (or at least a page someone is
  -- looking at) does: pressed, reported time on the page, or banked a word.
  signs_of_life as (
    select e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.name in ('visit_interacted', 'session_time')
      and e.props ->> 'player_id' is not null
    union
    select s.player_id::text from public.leaderboard_scores s
  ),
  bot_players as (
    select g.player_id
    from visit_gaps g
    where (g.gap_before <= interval '2 seconds' or g.gap_after <= interval '2 seconds')
      and not exists (select 1 from signs_of_life l where l.player_id = g.player_id)
    union
    select e.props ->> 'player_id'
    from public.analytics_events e
    where e.name = 'site_visit'
      and e.props ->> 'player_id' is not null
      and (e.props ->> 'webdriver' = 'true'
        or e.props ->> 'bot_ua' = 'true'
        or e.props ->> 'server_bot_ua' = 'true')
  ),
  -- Browsers that ever arrived from GitHub or Vercel -- the people building
  -- the game, clicking through from a pull request or a deploy -- the players
  -- listed by hand, and Muse.
  excluded_players as (
    select player_id from bot_players
    union
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)(github(\.com|\.io)?|vercel\.(com|app))$'
        or e.props ->> 'last_source' ~ '(^|\.)(github(\.com|\.io)?|vercel\.(com|app))$')
    union
    select player_id from public.analytics_excluded_players
    union
    select player_id from muse_players
  ),
  -- The date is checked before it is cast: the endpoint that writes events is
  -- public, and one malformed row must not take the report down.
  events as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      e.props ->> 'mode' as mode,
      e.props ->> 'reason' as reason,
      e.props ->> 'variant' as variant,
      e.props ->> 'experiment' as experiment,
      e.props ->> 'visit_type' as visit_type,
      e.props ->> 'to' as to_mode,
      e.created_at,
      case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as day
    from public.analytics_events e
    where e.name in ('site_visit', 'visit_interacted', 'visit_engaged', 'leaderboard_opened',
                     'found_words_opened', 'chat_opened', 'puzzle_completed', 'mode_assigned',
                     'ui_variant_assigned', 'result_copied', 'result_shared_on_x', 'mode_changed')
      and e.props ->> 'player_id' is not null
      and not exists (
        select 1 from excluded_players g where g.player_id = e.props ->> 'player_id')
  ),
  plays as (
    select distinct
      s.player_id::text as player_id,
      s.puzzle_date as day,
      case
        when s.mode in ('standard', 'freeform') then s.mode
        when s.puzzle_date >= date '2026-09-14' and s.puzzle_date < date '2026-09-27' then 'freeform'
        else 'standard'
      end as mode
    from public.leaderboard_scores s
    where not exists (
      select 1 from excluded_players g where g.player_id = s.player_id::text)
  ),
  -- 1 turned up, 2 acted, 3 guessed: a player's day is the most they did on it.
  activity as (
    select player_id, day, 1 as level from events where name = 'site_visit'
    union all
    select player_id, day, 2 from events where name not in ('site_visit', 'mode_assigned', 'ui_variant_assigned',
                                                           'result_copied', 'result_shared_on_x', 'mode_changed')
    union all
    select player_id, day, 3 from plays
  ),
  player_days as (
    select player_id, day, max(level) as level
    from activity
    group by 1, 2
  ),
  bounds as (
    select
      coalesce(p_today, (select max(day) from plays), max(day)) as today,
      coalesce(p_from, min(day)) as win_start,
      coalesce(p_to, max(day)) as win_end,
      min(day) as first_day
    from player_days
  ),

  arrivals as (
    select d.player_id, min(d.day) as first_day
    from player_days d
    group by 1
  ),
  retention as (
    select coalesce(jsonb_object_agg('d' || n.n, jsonb_build_object(
      'cohort', (select count(*) from arrivals a
        where a.first_day between b.today - n.n - 28 and b.today - n.n - 1),
      'returned', (select count(*) from arrivals a
        where a.first_day between b.today - n.n - 28 and b.today - n.n - 1
          and exists (select 1 from player_days d
            where d.player_id = a.player_id and d.day = a.first_day + n.n))
    )), '{}'::jsonb) as v
    from bounds b, (values (1), (7), (30)) as n(n)
  ),

  board_days as (
    select player_id, day, count(*) as opens
    from events
    where name = 'leaderboard_opened'
    group by 1, 2
  ),
  share_days as (
    select distinct player_id, day from events
    where name in ('result_copied', 'result_shared_on_x')
  ),
  -- The window's guessing days, each with what the player did that day and
  -- whether they played the next puzzle.
  guess_days as (
    select
      d.player_id,
      d.day,
      bd.player_id is not null as viewed,
      sh.player_id is not null as shared,
      d.day + 1 < b.today as closed,
      exists (select 1 from player_days n where n.player_id = d.player_id and n.day = d.day + 1) as next_day
    from player_days d
      cross join bounds b
      left join board_days bd on bd.player_id = d.player_id and bd.day = d.day
      left join share_days sh on sh.player_id = d.player_id and sh.day = d.day
    where d.level = 3 and d.day between b.win_start and b.win_end
  ),
  leaderboard as (
    select jsonb_build_object(
      'players', (select count(distinct d.player_id) from player_days d, bounds b
        where d.day between b.win_start and b.win_end),
      'viewers', count(distinct bd.player_id),
      'opens', coalesce(sum(bd.opens), 0),
      'viewDays', count(bd.player_id),
      'viewed', (select jsonb_build_object(
        'cohort', count(*) filter (where g.closed),
        'returned', count(*) filter (where g.closed and g.next_day)) from guess_days g where g.viewed),
      'notViewed', (select jsonb_build_object(
        'cohort', count(*) filter (where g.closed),
        'returned', count(*) filter (where g.closed and g.next_day)) from guess_days g where not g.viewed)
    ) as v
    from board_days bd
      join player_days d on d.player_id = bd.player_id and d.day = bd.day
      cross join bounds b
    where bd.day between b.win_start and b.win_end
  ),
  sharing as (
    select jsonb_build_object(
      'shared', jsonb_build_object(
        'cohort', count(*) filter (where g.shared and g.closed),
        'returned', count(*) filter (where g.shared and g.closed and g.next_day)),
      'notShared', jsonb_build_object(
        'cohort', count(*) filter (where not g.shared and g.closed),
        'returned', count(*) filter (where not g.shared and g.closed and g.next_day))
    ) as v
    from guess_days g
  ),

  -- A player's finished day once, on its best score.
  finishes as (
    select distinct on (f.player_id, f.day) f.player_id, f.day, f.tier
    from (
      select
        e.props ->> 'player_id' as player_id,
        case
          when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
          then (e.props ->> 'puzzle_date')::date
          else (e.created_at at time zone 'America/Denver')::date
        end as day,
        e.props ->> 'best_rarity' as tier,
        case when e.props ->> 'best_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (e.props ->> 'best_score')::numeric end as score
      from public.analytics_events e
      where e.name = 'puzzle_completed'
        and e.props ->> 'player_id' is not null
        and not exists (
          select 1 from excluded_players g where g.player_id = e.props ->> 'player_id')
    ) f
      cross join bounds b
    where f.day between b.win_start and b.win_end
    order by f.player_id, f.day, f.score desc nulls last
  ),
  scores as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tier', x.tier,
      'finished', x.finished,
      'shared', x.shared,
      'cohort', x.cohort,
      'returned', x.returned
    ) order by x.finished desc), '[]'::jsonb) as v
    from (
      select
        coalesce(f.tier, 'None') as tier,
        count(*) as finished,
        count(*) filter (where sh.player_id is not null) as shared,
        count(*) filter (where f.day + 1 < b.today) as cohort,
        count(*) filter (where f.day + 1 < b.today and exists (
          select 1 from player_days n where n.player_id = f.player_id and n.day = f.day + 1)) as returned
      from finishes f
        cross join bounds b
        left join share_days sh on sh.player_id = f.player_id and sh.day = f.day
      group by 1
    ) x
  )
  select jsonb_build_object(
    'today', (select today from bounds),
    'from', (select win_start from bounds),
    'to', (select win_end from bounds),
    'retention', (select v from retention),
    'leaderboard', (select v from leaderboard),
    'sharing', (select v from sharing),
    'scores', (select v from scores)
  );
$$;

-- Aggregates only, but read through the service role like analytics_overview:
-- revoke the defaults and grant service_role explicitly, since a new function
-- on the hosted stack grants it nothing by default.
revoke all on function public.analytics_gameplay(date, date, date) from public, anon, authenticated;
grant execute on function public.analytics_gameplay(date, date, date) to service_role;
