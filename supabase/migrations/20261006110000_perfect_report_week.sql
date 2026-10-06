-- (Numbered 20261006110000: 20261006100000 is estimated_score_report, the last on main;
-- 20261006030000 is the fourth perfect_report. This replaces it whole.)
--
-- Every rate gains a `week` beside `nextDay`: whether the player played again
-- within the seven puzzles after, not only the very next one. Skipping a
-- puzzle is not leaving, and since streak freezes (#389) it costs a player
-- less, so next-day alone counts every skip as a loss. A day is eligible for
-- `week` once its seven puzzles after are over, so the newest week of a window
-- has no week rate yet. Both correlations come in both: `correlation` (next
-- day) and `weekCorrelation`. Puzzle comparisons still start at the first
-- puzzle anybody hit a 10.00 on, and tied puzzles share a quartile (see
-- 20261006030000).
--
-- Do the players who keep hitting a perfect 10.00 stay longer? For the bottom
-- of /analytics, beside retention_report. A day is "perfect" when the player's
-- best word that puzzle scored 10.00 in either mode (the leaderboard's
-- top_score, capped at 10). Three views, each controlling for a little more:
--
--   firstPuzzle  new players: a 10.00 on their first puzzle or not, against
--                next-day and first-week return.
--   days         every player-day: was a 10.00 day followed by a play the next
--                puzzle more often than a day without one? Overall and per
--                mode, since Freeform does not fold and hands out more 10.00s.
--   samePlayers  the same comparison over only the players who have both kinds
--                of day, so who the player is cancels out.
--   players      players with three or more puzzles in the window, by how
--                often they hit a 10.00, against how many puzzles they played
--                and how often a puzzle was followed by the next one.
--   missed       the days without a 10.00, split by whether the puzzle was one
--                where 10.00s were common (more of its players hit one than on
--                the window's median puzzle) or rare. If missing on a common
--                day returns worse than missing on a rare one, watching others
--                hit it costs something; if better, the puzzle is doing the
--                work, not the player's own 10.00.
--   seen         the test of "other people's 10.00s cheapen the score": the
--                same missed days, split again by whether the player opened
--                the leaderboard or found words that day, where other
--                players' 10.00s show. If seeing them drives players off, those
--                who looked on a common day come back worst, and those who did
--                not look are the control. Events, so web only.
--   population   every player, by puzzle: puzzles in quartiles of how many of
--                their players hit a 10.00, against the next-day return of all
--                their players, and the correlation across puzzles.
--   casual       the same, and the 10.00-or-not day split, without the power
--                users: only days that were a player's first six puzzles. Cut
--                by where the player was that day, not by how many they went
--                on to play, since reaching seven is itself coming back and
--                cutting on it would take the returns out with them. A
--                puzzle's 10.00 share still counts everybody: that is what
--                the casual players saw.
--
-- Plays are the leaderboard's rows, as in retention_report, so this covers the
-- iOS app and the Reddit post too. The window is retention_report's, and so is
-- the floor: no group of fewer than five players leaves the database.

create or replace function public.perfect_report(p_days integer default 60, p_date date default null)
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
      s.top_score::numeric as top_score,
      case
        when s.mode in ('standard', 'freeform') then s.mode
        when s.puzzle_date >= date '2026-09-14' and s.puzzle_date < date '2026-09-27' then 'freeform'
        else 'standard'
      end as mode
    from public.leaderboard_scores s
    where not exists (select 1 from github_players g where g.player_id = s.player_id::text)
  ),
  player_days as (
    select
      player_id,
      puzzle_date,
      max(top_score) >= 10 as perfect,
      case when count(distinct mode) > 1 then 'both' else min(mode) end as mode
    from plays
    group by player_id, puzzle_date
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
  facts as (
    select
      d.*,
      min(d.puzzle_date) over (partition by d.player_id) as first_day,
      row_number() over (partition by d.player_id order by d.puzzle_date) as puzzle_number,
      coalesce(lead(d.puzzle_date) over (partition by d.player_id order by d.puzzle_date) = d.puzzle_date + 1,
        false) as returned_next,
      coalesce(lead(d.puzzle_date) over (partition by d.player_id order by d.puzzle_date) <= d.puzzle_date + 7,
        false) as returned_week
    from player_days d
  ),
  -- Days in the window, with whether their next puzzle is over: the latest
  -- puzzle is still being played and cannot say whether anybody came back.
  win_days as (
    select x.*, x.puzzle_date < w.as_of as eligible, x.puzzle_date + 7 < w.as_of as eligible_week
    from facts x, win w
    where x.puzzle_date between w.win_start and w.win_end
  ),

  -- Part 1. New players at their first puzzle.
  first_puzzle as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'perfect', f.perfect,
      'players', f.players,
      'nextDay', jsonb_build_object('cohort', f.d1_cohort, 'returned', f.d1_returned),
      'week', jsonb_build_object('cohort', f.wk_cohort, 'returned', f.wk_returned)
    ) order by f.perfect desc), '[]'::jsonb) as v
    from (
      select
        x.perfect,
        count(*) as players,
        count(*) filter (where x.first_day < w.as_of) as d1_cohort,
        count(*) filter (where x.first_day < w.as_of and x.returned_next) as d1_returned,
        count(*) filter (where x.first_day + 7 < w.as_of) as wk_cohort,
        count(*) filter (where x.first_day + 7 < w.as_of and x.returned_week) as wk_returned
      from win_days x, win w
      where x.puzzle_date = x.first_day
      group by x.perfect
      having count(*) >= 5
    ) f
  ),

  -- Part 2. Every player-day, overall and per mode. A day played in both
  -- modes counts under "all" only.
  day_groups as (
    select 'all' as split, * from win_days
    union all
    select mode, * from win_days where mode in ('standard', 'freeform')
  ),
  day_split as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mode', g.mode,
      'perfect', g.perfect,
      'players', g.players,
      'days', g.days,
      'nextDay', jsonb_build_object('cohort', g.cohort, 'returned', g.returned),
      'week', jsonb_build_object('cohort', g.wk_cohort, 'returned', g.wk_returned)
    ) order by case g.mode when 'all' then 1 when 'standard' then 2 else 3 end, g.perfect desc), '[]'::jsonb) as v
    from (
      select
        split as mode,
        perfect,
        count(distinct player_id) as players,
        count(*) as days,
        count(*) filter (where eligible) as cohort,
        count(*) filter (where eligible and returned_next) as returned,
        count(*) filter (where eligible_week) as wk_cohort,
        count(*) filter (where eligible_week and returned_week) as wk_returned
      from day_groups
      group by split, perfect
      having count(distinct player_id) >= 5
    ) g
  ),

  -- Part 5. Each puzzle's share of players who hit a 10.00, against the
  -- window's median puzzle. Puzzles under five players are too few to call
  -- either way and are left out.
  era as (
    select min(puzzle_date) as since from player_days where perfect
  ),
  puzzle_rates as (
    select x.puzzle_date, avg(case when x.perfect then 1 else 0 end) as perfect_share
    from win_days x, era
    where x.puzzle_date >= era.since
    group by x.puzzle_date
    having count(*) >= 5
  ),
  median as (
    select percentile_cont(0.5) within group (order by perfect_share) as v from puzzle_rates
  ),
  missed_split as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'group', g.grp,
      'players', g.players,
      'days', g.days,
      'puzzles', g.puzzles,
      'nextDay', jsonb_build_object('cohort', g.cohort, 'returned', g.returned),
      'week', jsonb_build_object('cohort', g.wk_cohort, 'returned', g.wk_returned)
    ) order by g.ord), '[]'::jsonb) as v
    from (
      select
        case when x.perfect then 1 when r.perfect_share > m.v then 2 else 3 end as ord,
        case when x.perfect then 'Hit a 10.00'
             when r.perfect_share > m.v then 'Missed, on a puzzle where 10.00s were common'
             else 'Missed, on a puzzle where 10.00s were rare' end as grp,
        count(distinct x.player_id) as players,
        count(*) as days,
        count(distinct x.puzzle_date) as puzzles,
        count(*) filter (where x.eligible) as cohort,
        count(*) filter (where x.eligible and x.returned_next) as returned,
        count(*) filter (where x.eligible_week) as wk_cohort,
        count(*) filter (where x.eligible_week and x.returned_week) as wk_returned
      from win_days x
      join puzzle_rates r on r.puzzle_date = x.puzzle_date
      cross join median m
      group by 1, 2
      having count(distinct x.player_id) >= 5
    ) g
  ),

  -- Part 6. Who looked at the boards that day. The puzzle an event names is
  -- read safely, as in retention_report: the endpoint is public.
  looks as (
    select distinct e.props ->> 'player_id' as player_id, (e.props ->> 'puzzle_date')::date as puzzle_date
    from public.analytics_events e
    where e.name in ('leaderboard_opened', 'found_words_opened')
      and e.props ->> 'player_id' is not null
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
  ),
  -- A player-day with any event at all, so "did not look" means a tracked day
  -- without a look, not an iOS or Reddit day that could not have said.
  tracked as (
    select distinct e.props ->> 'player_id' as player_id, (e.props ->> 'puzzle_date')::date as puzzle_date
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
  ),
  seen_split as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'looked', g.looked,
      'common', g.common,
      'players', g.players,
      'days', g.days,
      'nextDay', jsonb_build_object('cohort', g.cohort, 'returned', g.returned),
      'week', jsonb_build_object('cohort', g.wk_cohort, 'returned', g.wk_returned)
    ) order by g.looked desc, g.common desc), '[]'::jsonb) as v
    from (
      select
        l.player_id is not null as looked,
        r.perfect_share > m.v as common,
        count(distinct x.player_id) as players,
        count(*) as days,
        count(*) filter (where x.eligible) as cohort,
        count(*) filter (where x.eligible and x.returned_next) as returned,
        count(*) filter (where x.eligible_week) as wk_cohort,
        count(*) filter (where x.eligible_week and x.returned_week) as wk_returned
      from win_days x
      join tracked t on t.player_id = x.player_id and t.puzzle_date = x.puzzle_date
      join puzzle_rates r on r.puzzle_date = x.puzzle_date
      cross join median m
      left join looks l on l.player_id = x.player_id and l.puzzle_date = x.puzzle_date
      where not x.perfect
      group by 1, 2
      having count(distinct x.player_id) >= 5
    ) g
  ),

  -- Part 7. The whole population, a puzzle at a time.
  puzzle_return as (
    select
      r.puzzle_date,
      r.perfect_share,
      count(*) as players,
      count(*) filter (where x.eligible) as cohort,
      count(*) filter (where x.eligible and x.returned_next) as returned,
      count(*) filter (where x.eligible_week) as wk_cohort,
      count(*) filter (where x.eligible_week and x.returned_week) as wk_returned,
      least(4, 1 + floor(percent_rank() over (order by r.perfect_share) * 4))::int as quartile
    from puzzle_rates r
    join win_days x on x.puzzle_date = r.puzzle_date
    group by r.puzzle_date, r.perfect_share
  ),
  population as (
    select jsonb_build_object(
      -- Over the puzzles whose next one is over, one point per puzzle.
      'puzzles', (select count(*) from puzzle_return where cohort > 0),
      'correlation', (select round(corr(perfect_share, returned::numeric / cohort)::numeric, 2)
                      from puzzle_return where cohort > 0),
      'weekCorrelation', (select round(corr(perfect_share, wk_returned::numeric / wk_cohort)::numeric, 2)
                      from puzzle_return where wk_cohort > 0),
      'quartiles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'quartile', q.quartile,
          'puzzles', q.puzzles,
          'minShare', q.min_share,
          'maxShare', q.max_share,
          'players', q.players,
          'nextDay', jsonb_build_object('cohort', q.cohort, 'returned', q.returned),
      'week', jsonb_build_object('cohort', q.wk_cohort, 'returned', q.wk_returned)
        ) order by q.quartile), '[]'::jsonb)
        from (
          select quartile, count(*) as puzzles,
            round(min(perfect_share), 3) as min_share, round(max(perfect_share), 3) as max_share,
            sum(players) as players, sum(cohort) as cohort, sum(returned) as returned,
            sum(wk_cohort) as wk_cohort, sum(wk_returned) as wk_returned
          from puzzle_return
          group by quartile
        ) q
      )
    ) as v
  ),

  -- Part 8. Without the power users: days that were a player's first six.
  casual_days as (
    select x.*, r.perfect_share, pr.quartile
    from win_days x
    join puzzle_rates r on r.puzzle_date = x.puzzle_date
    join puzzle_return pr on pr.puzzle_date = x.puzzle_date
    where x.puzzle_number <= 6
  ),
  casual_puzzles as (
    select puzzle_date, perfect_share, quartile,
      count(*) as players,
      count(*) filter (where eligible) as cohort,
      count(*) filter (where eligible and returned_next) as returned,
      count(*) filter (where eligible_week) as wk_cohort,
      count(*) filter (where eligible_week and returned_week) as wk_returned
    from casual_days
    group by puzzle_date, perfect_share, quartile
  ),
  casual as (
    select jsonb_build_object(
      'puzzles', (select count(*) from casual_puzzles where cohort > 0),
      'correlation', (select round(corr(perfect_share, returned::numeric / cohort)::numeric, 2)
                      from casual_puzzles where cohort > 0),
      'weekCorrelation', (select round(corr(perfect_share, wk_returned::numeric / wk_cohort)::numeric, 2)
                      from casual_puzzles where wk_cohort > 0),
      'quartiles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'quartile', q.quartile,
          'puzzles', q.puzzles,
          'minShare', q.min_share,
          'maxShare', q.max_share,
          'players', q.players,
          'nextDay', jsonb_build_object('cohort', q.cohort, 'returned', q.returned),
      'week', jsonb_build_object('cohort', q.wk_cohort, 'returned', q.wk_returned)
        ) order by q.quartile), '[]'::jsonb)
        from (
          select quartile, count(*) as puzzles,
            round(min(perfect_share), 3) as min_share, round(max(perfect_share), 3) as max_share,
            sum(players) as players, sum(cohort) as cohort, sum(returned) as returned,
            sum(wk_cohort) as wk_cohort, sum(wk_returned) as wk_returned
          from casual_puzzles
          group by quartile
          having sum(players) >= 5
        ) q
      ),
      'days', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'perfect', g.perfect,
          'players', g.players,
          'days', g.days,
          'nextDay', jsonb_build_object('cohort', g.cohort, 'returned', g.returned),
      'week', jsonb_build_object('cohort', g.wk_cohort, 'returned', g.wk_returned)
        ) order by g.perfect desc), '[]'::jsonb)
        from (
          select perfect, count(distinct player_id) as players, count(*) as days,
            count(*) filter (where eligible) as cohort,
            count(*) filter (where eligible and returned_next) as returned,
            count(*) filter (where eligible_week) as wk_cohort,
            count(*) filter (where eligible_week and returned_week) as wk_returned
          from casual_days
          group by perfect
          having count(distinct player_id) >= 5
        ) g
      )
    ) as v
  ),

  -- Part 3. Only the players with both a 10.00 day and another day whose next
  -- puzzle is over, each side pooled over their days.
  mixed as (
    select player_id
    from win_days
    where eligible
    group by player_id
    having bool_or(perfect) and bool_or(not perfect)
  ),
  same_players as (
    select jsonb_build_object(
      'players', (select count(*) from mixed),
      'perfect', case when (select count(*) from mixed) >= 5 then jsonb_build_object(
        'cohort', count(*) filter (where x.perfect),
        'returned', count(*) filter (where x.perfect and x.returned_next)) end,
      'other', case when (select count(*) from mixed) >= 5 then jsonb_build_object(
        'cohort', count(*) filter (where not x.perfect),
        'returned', count(*) filter (where not x.perfect and x.returned_next)) end,
      'week', case when (select count(*) from mixed) >= 5 then jsonb_build_object(
        'perfect', jsonb_build_object(
          'cohort', count(*) filter (where x.perfect and x.eligible_week),
          'returned', count(*) filter (where x.perfect and x.eligible_week and x.returned_week)),
        'other', jsonb_build_object(
          'cohort', count(*) filter (where not x.perfect and x.eligible_week),
          'returned', count(*) filter (where not x.perfect and x.eligible_week and x.returned_week))) end
    ) as v
    from win_days x
    join mixed m on m.player_id = x.player_id
    where x.eligible
  ),

  -- Part 4. Players with three or more puzzles in the window, by the share of
  -- them with a 10.00. Three, so that one lucky day is not "every time".
  regulars as (
    select
      player_id,
      count(*) as puzzles,
      avg(case when perfect then 1 else 0 end) as perfect_share,
      count(*) filter (where eligible) as cohort,
      count(*) filter (where eligible and returned_next) as returned,
      count(*) filter (where eligible_week) as wk_cohort,
      count(*) filter (where eligible_week and returned_week) as wk_returned
    from win_days
    group by player_id
    having count(*) >= 3
  ),
  player_split as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'group', r.grp,
      'players', r.players,
      'avgPuzzles', r.avg_puzzles,
      'nextDay', jsonb_build_object('cohort', r.cohort, 'returned', r.returned),
      'week', jsonb_build_object('cohort', r.wk_cohort, 'returned', r.wk_returned)
    ) order by r.ord), '[]'::jsonb) as v
    from (
      select
        case when perfect_share = 0 then 1 when perfect_share < 1.0 / 3 then 2
             when perfect_share < 2.0 / 3 then 3 else 4 end as ord,
        case when perfect_share = 0 then 'Never' when perfect_share < 1.0 / 3 then 'Under a third of puzzles'
             when perfect_share < 2.0 / 3 then 'A third to two thirds' else 'Two thirds or more' end as grp,
        count(*) as players,
        round(avg(puzzles), 1) as avg_puzzles,
        sum(cohort) as cohort,
        sum(returned) as returned,
        sum(wk_cohort) as wk_cohort,
        sum(wk_returned) as wk_returned
      from regulars
      group by 1, 2
      having count(*) >= 5
    ) r
  )

  select jsonb_build_object(
    'from', (select win_start from win),
    'to', (select win_end from win),
    -- The first puzzle anybody hit a 10.00 on: the puzzle comparisons start here.
    'perfectSince', (select since from era),
    'firstPuzzle', (select v from first_puzzle),
    'days', (select v from day_split),
    'samePlayers', (select v from same_players),
    'players', (select v from player_split),
    'missed', jsonb_build_object(
      'medianShare', (select round(v::numeric, 3) from median),
      'groups', (select v from missed_split)),
    'seen', (select v from seen_split),
    'population', (select v from population),
    'casual', (select v from casual)
  );
$$;

comment on function public.perfect_report(integer, date) is
  'Whether players who hit a 10.00 come back more, for the bottom of the /analytics page. Read by api/review.ts alongside analytics_report.';

-- service_role does not inherit what public is given; grant it explicitly.
revoke all on function public.perfect_report(integer, date) from public, anon, authenticated;
grant execute on function public.perfect_report(integer, date) to service_role;
