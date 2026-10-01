-- copy_report: how often players copy a word into the other mode, and whether
-- the players who do keep coming back.
--
-- Every banked word in the guess log shows what it scores in the mode the
-- player is not in, with a control that banks it there too (see
-- src/game/crossMode.ts). Each tap sends one `answer_copied` event, whatever
-- happened: `outcome` is `copied` for a word banked, `refused` for one the other
-- mode would not take, `full` for a tap on a finished game, `lookup_failed` for
-- a live check that could not answer.
--
-- Its own function, read alongside analytics_report by api/review.ts and set on
-- the report as `copies`, the same way chat_report is. It takes the same window
-- -- `p_days` wide, ending on `p_date` or the latest puzzle anybody played --
-- and scopes every event by the puzzle it names, never by when it arrived.
--
-- Retention is asked two ways, both off leaderboard_scores (live days only, any
-- mode, as analytics_report's retention):
--
--   nextDay  Every player-day in the window before the latest puzzle, split by
--            whether the player copied a word that day. Returned is a play on
--            the next puzzle. The fair-ish comparison: same players, same
--            window, copy days against the rest.
--   week     Every player who played in the window, split by whether they ever
--            copied in it. A copier's day is their first copy in the window, a
--            non-copier's their first play in it; returned is any play in the
--            seven puzzles after. In the cohort once those seven are over.
--
-- Copiers are self-selected -- a player engaged enough to read the other mode's
-- price is engaged -- so neither is a causal answer. The page says so.
--
-- GitHub traffic is left out as everywhere else. Nothing identifying leaves the
-- function: counts and shares.

create or replace function public.copy_report(p_days integer default 60, p_date date default null)
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
  player_days as (
    select distinct s.player_id::text as player_id, s.puzzle_date
    from public.leaderboard_scores s
    where not exists (select 1 from github_players g where g.player_id = s.player_id::text)
  ),
  -- `as_of` is the latest puzzle anybody is on, which is what retention waits
  -- for; `win_end` is where the window stops, as analytics_report's.
  bounds as (
    select
      max(puzzle_date) as as_of,
      coalesce(p_date, max(puzzle_date)) as win_end
    from player_days
  ),
  win as (
    select b.win_end - (days.n - 1) as win_start, b.win_end, b.as_of
    from bounds b, days
  ),
  -- Every copy tap in the window, its date read safely: the endpoint is public,
  -- and one malformed row must not take the report down.
  events as (
    select
      e.props ->> 'player_id' as player_id,
      (e.props ->> 'puzzle_date')::date as puzzle_date,
      e.props ->> 'outcome' as outcome,
      e.props ->> 'to' as to_mode,
      case when jsonb_typeof(e.props -> 'score_from') = 'number'
        then (e.props ->> 'score_from')::numeric end as score_from,
      case when jsonb_typeof(e.props -> 'score_to') = 'number'
        then (e.props ->> 'score_to')::numeric end as score_to
    from public.analytics_events e, win w
    where e.name = 'answer_copied'
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
      and (e.props ->> 'puzzle_date')::date between w.win_start and w.win_end
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  copies as (
    select * from events where outcome = 'copied' and player_id is not null
  ),
  copy_days as (
    select distinct player_id, puzzle_date from copies
  ),
  window_days as (
    select d.* from player_days d, win w
    where d.puzzle_date between w.win_start and w.win_end
  ),

  totals as (
    select jsonb_build_object(
      'taps', (select count(*) from events),
      'copies', (select count(*) from copies),
      'copiers', (select count(distinct player_id) from copies),
      'toFreeform', (select count(*) from copies where to_mode = 'freeform'),
      'toStandard', (select count(*) from copies where to_mode = 'standard'),
      'refused', (select count(*) from events where outcome = 'refused'),
      'full', (select count(*) from events where outcome = 'full'),
      'lookupFailed', (select count(*) from events where outcome = 'lookup_failed'),
      -- Everybody who played in the window, for the share who copy.
      'players', (select count(distinct player_id) from window_days),
      'avgCopiesPerCopier', (select round(count(*)::numeric / nullif(count(distinct player_id), 0), 2)
                             from copies),
      -- How much the copied word gained (or lost) by the move, on average.
      'avgScoreGain', (select round(avg(score_to - score_from), 2) from copies
                       where score_to is not null and score_from is not null),
      'higherThere', (select count(*) from copies where score_to > score_from),
      'since', (select min((e.props ->> 'puzzle_date')::date)
                from public.analytics_events e
                where e.name = 'answer_copied'
                  and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  and pg_input_is_valid(e.props ->> 'puzzle_date', 'date'))
    ) as v
  ),

  -- One row per puzzle in the window, from the first copy on: before it there
  -- is only a line of zeros for a control that did not exist.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', g.day,
      'copies', coalesce(a.copies, 0),
      'copiers', coalesce(a.copiers, 0),
      'players', coalesce(p.players, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (
      select gs::date as day
      from win w,
        generate_series(greatest(w.win_start, (select min(puzzle_date) from copies)),
                        w.win_end, interval '1 day') as gs
      where w.win_end is not null and exists (select 1 from copies)
    ) g
      left join (
        select puzzle_date, count(*) as copies, count(distinct player_id) as copiers
        from copies group by puzzle_date
      ) a on a.puzzle_date = g.day
      left join (
        select puzzle_date, count(*) as players from window_days group by puzzle_date
      ) p on p.puzzle_date = g.day
  ),

  next_day as (
    select
      exists (select 1 from copy_days c
              where c.player_id = d.player_id and c.puzzle_date = d.puzzle_date) as copied,
      exists (select 1 from player_days n
              where n.player_id = d.player_id and n.puzzle_date = d.puzzle_date + 1) as returned
    from window_days d, win w
    where d.puzzle_date < w.as_of
  ),

  anchors as (
    select
      p.player_id,
      coalesce(
        (select min(c.puzzle_date) from copy_days c where c.player_id = p.player_id),
        min(p.puzzle_date)) as day,
      exists (select 1 from copy_days c where c.player_id = p.player_id) as copier
    from window_days p
    group by p.player_id
  ),
  week as (
    select
      a.copier,
      exists (select 1 from player_days d
              where d.player_id = a.player_id
                and d.puzzle_date > a.day and d.puzzle_date <= a.day + 7) as returned
    from anchors a, win w
    where a.day + 7 < w.as_of
  ),

  retention as (
    select jsonb_build_object(
      'nextDay', jsonb_build_object(
        'copied', jsonb_build_object(
          'cohort', (select count(*) from next_day where copied),
          'returned', (select count(*) from next_day where copied and returned)),
        'other', jsonb_build_object(
          'cohort', (select count(*) from next_day where not copied),
          'returned', (select count(*) from next_day where not copied and returned))),
      'week', jsonb_build_object(
        'copied', jsonb_build_object(
          'cohort', (select count(*) from week where copier),
          'returned', (select count(*) from week where copier and returned)),
        'other', jsonb_build_object(
          'cohort', (select count(*) from week where not copier),
          'returned', (select count(*) from week where not copier and returned)))
    ) as v
  )

  select jsonb_build_object(
    'totals', (select v from totals),
    'daily', (select v from daily),
    'retention', (select v from retention)
  );
$$;

comment on function public.copy_report(integer, date) is
  'Copies of a word into the other mode, and the retention of the players who copy, for the /analytics page. Read by api/review.ts alongside analytics_report.';

-- Explicit, for the reason every recent migration gives: service_role does not
-- inherit what public is given, and a clean stack grants it nothing by default.
revoke all on function public.copy_report(integer, date) from public, anon, authenticated;
grant execute on function public.copy_report(integer, date) to service_role;
