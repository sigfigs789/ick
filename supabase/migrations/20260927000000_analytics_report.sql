-- The analytics page: who plays, whether they come back, and what that depends
-- on -- the day of the week, the rules they played under, where they came from.
--
-- One function, one JSON document. The page is a single read of a dozen small
-- aggregates, and asking PostgREST for them one at a time would be a dozen round
-- trips for numbers that only mean anything side by side.
--
-- Two sources, and each is used for the question it can actually answer.
--
--   leaderboard_scores  a row per player per live puzzle they banked a word on.
--                       Every browser mints a board id on first open, so this is
--                       the one place a player's history is a history: first
--                       day, days since, next-day return. Archive play never
--                       reaches it (see `submitScore`), so a "play" here is a
--                       live day, which is what retention should count. A day
--                       opened and abandoned without a word leaves no row, so
--                       these are players, not visitors.
--   analytics_events    the event mirror. Visits, sessions, shares and sources
--                       live only here. Most rows before 2026-09-25 carry no
--                       player id, so nothing below reads a person out of it --
--                       only counts of events.
--
-- Nothing leaves this function that identifies anybody: every value is a count,
-- a rate or an average, and the smallest group any of them is taken over is a
-- day's players. The page is still keyed (see api/review.ts), because a running
-- tally of how the game is doing is the maintainer's, not the players'.
--
-- "Mode" for a day before the switch existed is the mode everybody played it
-- in: Freeform for the trial week (FREEFORM_TRIAL_START to MODE_CHOICE_START in
-- src/game/mode.ts), Standard otherwise. From MODE_CHOICE_START it is the row's
-- own. So the before-the-choice comparison is a comparison of weeks, and the
-- page says so.
--
-- Weeks start on Sunday, as the game's own do (src/game/week.ts).

create or replace function public.analytics_report(p_days integer default 60)
returns jsonb
language sql
stable
as $$
  with
  days as (select greatest(7, least(coalesce(p_days, 60), 365)) as n),
  plays as (
    select
      s.player_id,
      s.puzzle_date,
      s.words,
      s.total_score::numeric as total_score,
      s.top_score::numeric as top_score,
      case
        when s.mode in ('standard', 'freeform') then s.mode
        when s.puzzle_date >= date '2026-09-14' and s.puzzle_date < date '2026-09-27' then 'freeform'
        else 'standard'
      end as mode
    from public.leaderboard_scores s
    -- A player may hold both a Standard and a Freeform row for one day from the
    -- split on. Both are real play and both count toward that mode's numbers;
    -- the per-player-per-day questions below collapse them with `distinct`.
  ),
  -- The last puzzle with anybody on it. Everything is measured up to here rather
  -- than to the server's clock, because "today" is the puzzle the players are on
  -- and the players are spread across time zones.
  bounds as (
    select max(puzzle_date) as as_of from plays
  ),
  player_days as (
    select distinct player_id, puzzle_date from plays
  ),
  firsts as (
    select player_id, min(puzzle_date) as first_day, count(*) as days_played
    from player_days
    group by player_id
  ),
  -- Whether each player-day was followed by the next day's puzzle. Only days
  -- strictly before the latest one are eligible: the latest is still being
  -- played, and nobody has had the chance to come back after it.
  next_day as (
    select
      d.player_id,
      d.puzzle_date,
      exists (
        select 1 from player_days n
        where n.player_id = d.player_id and n.puzzle_date = d.puzzle_date + 1
      ) as returned
    from player_days d, bounds b
    where d.puzzle_date < b.as_of
  ),

  totals as (
    select jsonb_build_object(
      'players', (select count(*) from firsts),
      'plays', (select count(*) from player_days),
      'last7', (select count(distinct player_id) from player_days, bounds
                where puzzle_date > as_of - 7),
      'last30', (select count(distinct player_id) from player_days, bounds
                 where puzzle_date > as_of - 30),
      'today', (select count(distinct player_id) from player_days, bounds
                where puzzle_date = as_of),
      'avgDaysPerPlayer', (select round(avg(days_played), 2) from firsts),
      'firstDay', (select min(puzzle_date) from plays)
    ) as v
  ),

  -- One row per puzzle in the window, including a day nobody played -- but not
  -- the days before anybody had, which would only be a flat line of zeros.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', g.day,
      'players', coalesce(a.players, 0),
      'newPlayers', coalesce(f.new_players, 0),
      'standard', coalesce(a.standard, 0),
      'freeform', coalesce(a.freeform, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (
      select gs::date as day
      from bounds b, days,
        generate_series(
          greatest(b.as_of - (days.n - 1), (select min(puzzle_date) from plays)),
          b.as_of, interval '1 day') as gs
      where b.as_of is not null
    ) g
      left join (
        select puzzle_date,
          count(distinct player_id) as players,
          count(distinct player_id) filter (where mode = 'standard') as standard,
          count(distinct player_id) filter (where mode = 'freeform') as freeform
        from plays group by puzzle_date
      ) a on a.puzzle_date = g.day
      left join (
        select first_day, count(*) as new_players from firsts group by first_day
      ) f on f.first_day = g.day
  ),

  -- Classic Day-N retention: of the players whose first puzzle was N or more
  -- days before the latest, how many played exactly N days after it. Plus the
  -- softer "came back at all within the first week", which is the one a small
  -- daily game moves first.
  retention as (
    select jsonb_build_object(
      'd1', jsonb_build_object(
        'cohort', count(*) filter (where f.first_day + 1 < b.as_of),
        'returned', count(*) filter (where f.first_day + 1 < b.as_of and exists (
          select 1 from player_days d where d.player_id = f.player_id and d.puzzle_date = f.first_day + 1)) ),
      'd7', jsonb_build_object(
        'cohort', count(*) filter (where f.first_day + 7 < b.as_of),
        'returned', count(*) filter (where f.first_day + 7 < b.as_of and exists (
          select 1 from player_days d where d.player_id = f.player_id and d.puzzle_date = f.first_day + 7)) ),
      'd30', jsonb_build_object(
        'cohort', count(*) filter (where f.first_day + 30 < b.as_of),
        'returned', count(*) filter (where f.first_day + 30 < b.as_of and exists (
          select 1 from player_days d where d.player_id = f.player_id and d.puzzle_date = f.first_day + 30)) ),
      'week1', jsonb_build_object(
        'cohort', count(*) filter (where f.first_day + 7 < b.as_of),
        'returned', count(*) filter (where f.first_day + 7 < b.as_of and exists (
          select 1 from player_days d where d.player_id = f.player_id
            and d.puzzle_date > f.first_day and d.puzzle_date <= f.first_day + 7)) )
    ) as v
    from firsts f, bounds b
  ),

  -- Weekly cohorts: players grouped by the Sunday-started week of their first
  -- puzzle, and the share of each still playing some day of each later week.
  -- The last twelve cohorts, which is as far back as a grid stays readable.
  cohort_rows as (
    select
      f.player_id,
      f.first_day - extract(dow from f.first_day)::int as cohort_week
    from firsts f
  ),
  cohort_activity as (
    select
      c.cohort_week,
      ((d.puzzle_date - extract(dow from d.puzzle_date)::int) - c.cohort_week) / 7 as week_offset,
      count(distinct c.player_id) as active
    from cohort_rows c
    join player_days d on d.player_id = c.player_id
    group by 1, 2
  ),
  cohorts as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week', w.cohort_week,
      'size', w.size,
      'active', w.active
    ) order by w.cohort_week), '[]'::jsonb) as v
    from (
      select
        c.cohort_week,
        (select count(*) from cohort_rows r where r.cohort_week = c.cohort_week) as size,
        -- Every week from the cohort's own to the current one, a quiet week
        -- included as a zero, so position k in the list is always week k.
        (select jsonb_agg(coalesce(a.active, 0) order by o.k)
           from generate_series(
             0, ((b.as_of - extract(dow from b.as_of)::int) - c.cohort_week) / 7) as o(k)
           left join cohort_activity a
             on a.cohort_week = c.cohort_week and a.week_offset = o.k) as active
      from (select distinct cohort_week from cohort_rows) c, bounds b
      order by c.cohort_week desc
      limit 12
    ) w
  ),

  -- By day of the week the puzzle fell on (0 = Sunday). Averages are per puzzle
  -- rather than totals, so a weekday that happens to have come round one more
  -- time does not look busier for it.
  weekday as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dow', w.dow,
      'puzzles', w.puzzles,
      'avgPlayers', w.avg_players,
      'avgNewPlayers', w.avg_new,
      'avgWords', w.avg_words,
      'avgTotal', w.avg_total,
      'nextDayCohort', w.nd_cohort,
      'nextDayReturned', w.nd_returned
    ) order by w.dow), '[]'::jsonb) as v
    from (
      select
        dow.dow,
        (select count(distinct puzzle_date) from plays p
          where extract(dow from p.puzzle_date) = dow.dow) as puzzles,
        (select round(avg(c), 1) from (
          select count(distinct player_id) as c from plays p
          where extract(dow from p.puzzle_date) = dow.dow group by puzzle_date) x) as avg_players,
        (select round(avg(c), 1) from (
          select count(*) as c from firsts f
          where extract(dow from f.first_day) = dow.dow group by first_day) x) as avg_new,
        (select round(avg(words), 2) from plays p
          where extract(dow from p.puzzle_date) = dow.dow) as avg_words,
        (select round(avg(total_score), 2) from plays p
          where extract(dow from p.puzzle_date) = dow.dow) as avg_total,
        (select count(*) from next_day n
          where extract(dow from n.puzzle_date) = dow.dow) as nd_cohort,
        (select count(*) filter (where returned) from next_day n
          where extract(dow from n.puzzle_date) = dow.dow) as nd_returned
      from generate_series(0, 6) as dow(dow)
    ) w
  ),

  -- By the rules a day was played under. `nextDay` is whether a day in that
  -- mode was followed by any play the next day, in either mode -- the question
  -- is whether the mode brings people back, not whether it keeps them in it.
  modes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mode', m.mode,
      'players', m.players,
      'plays', m.plays,
      'avgWords', m.avg_words,
      'avgTotal', m.avg_total,
      'avgTop', m.avg_top,
      'nextDayCohort', m.nd_cohort,
      'nextDayReturned', m.nd_returned
    ) order by m.mode desc), '[]'::jsonb) as v
    from (
      select
        p.mode,
        count(distinct p.player_id) as players,
        count(*) as plays,
        round(avg(p.words), 2) as avg_words,
        round(avg(p.total_score), 2) as avg_total,
        round(avg(p.top_score), 2) as avg_top,
        count(n.*) as nd_cohort,
        count(*) filter (where n.returned) as nd_returned
      from plays p
      left join next_day n on n.player_id = p.player_id and n.puzzle_date = p.puzzle_date
      group by p.mode
    ) m
  ),

  -- How many days each player has played, bucketed. The shape of this -- one
  -- tall bar, or a long tail -- is the plainest picture of whether it sticks.
  depth as (
    select coalesce(jsonb_agg(jsonb_build_object('bucket', b.label, 'players', coalesce(c.players, 0))
      order by b.ord), '[]'::jsonb) as v
    from (values (1, '1 day', 1, 1), (2, '2–3', 2, 3), (3, '4–7', 4, 7),
                 (4, '8–14', 8, 14), (5, '15–30', 15, 30), (6, '31+', 31, 100000))
      as b(ord, label, lo, hi)
    left join (
      select b2.ord, count(*) as players
      from firsts f
      join (values (1, 1, 1), (2, 2, 3), (3, 4, 7), (4, 8, 14), (5, 15, 30), (6, 31, 100000))
        as b2(ord, lo, hi) on f.days_played between b2.lo and b2.hi
      group by b2.ord
    ) c on c.ord = b.ord
  ),

  -- Everything from here reads the event log, over the same window as `daily`
  -- by server receipt time -- event rows have no puzzle to scope them by.
  events as (
    select e.name, e.props, e.created_at
    from public.analytics_events e, days
    where e.created_at >= now() - make_interval(days => days.n)
      and e.name in ('site_visit', 'visit_engaged', 'puzzle_completed',
                     'result_copied', 'result_shared_on_x', 'session_time', 'mode_changed')
  ),

  funnel as (
    select jsonb_build_object(
      'visits', count(*) filter (where name = 'site_visit'),
      'firstVisits', count(*) filter (where name = 'site_visit' and props ->> 'visit_type' = 'first'),
      'engaged', count(*) filter (where name = 'visit_engaged'),
      'completed', count(*) filter (where name = 'puzzle_completed'),
      'won', count(*) filter (where name = 'puzzle_completed' and (props ->> 'won') = 'true'),
      'shared', count(*) filter (where name in ('result_copied', 'result_shared_on_x')),
      'sharedOnX', count(*) filter (where name = 'result_shared_on_x'),
      'toFreeform', count(*) filter (where name = 'mode_changed' and props ->> 'to' = 'freeform'),
      'toStandard', count(*) filter (where name = 'mode_changed' and props ->> 'to' = 'standard')
    ) as v
    from events
  ),

  -- Where visits come from, and what share of each source's visits went on to
  -- play a word. Keyed on the source the visitor first arrived through.
  sources as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', s.source,
      'visits', s.visits,
      'firstVisits', s.first_visits,
      'engaged', s.engaged
    ) order by s.visits desc), '[]'::jsonb) as v
    from (
      select
        coalesce(props ->> 'source', 'direct') as source,
        count(*) filter (where name = 'site_visit') as visits,
        count(*) filter (where name = 'site_visit' and props ->> 'visit_type' = 'first') as first_visits,
        count(*) filter (where name = 'visit_engaged') as engaged
      from events
      where name in ('site_visit', 'visit_engaged')
      group by 1
    ) s
    where s.visits > 0
  ),

  -- Sessions report more than once (see trackSessionTime), so each is taken at
  -- its largest `visible_ms` -- its final running total.
  sessions as (
    select
      props ->> 'session_id' as session_id,
      max((props ->> 'visible_ms')::numeric) as visible_ms,
      max((props ->> 'time_to_first_guess_ms')::numeric) as first_guess_ms,
      bool_or((props ->> 'guessed') = 'true') as guessed,
      bool_or((props ->> 'shared') = 'true') as shared
    from events
    where name = 'session_time' and props ? 'session_id'
      and jsonb_typeof(props -> 'visible_ms') = 'number'
    group by 1
  ),
  session_stats as (
    select jsonb_build_object(
      'sessions', count(*),
      'medianVisibleMs', percentile_cont(0.5) within group (order by visible_ms),
      'medianPlayingMs', percentile_cont(0.5) within group (order by visible_ms) filter (where guessed),
      'medianFirstGuessMs', percentile_cont(0.5) within group (order by first_guess_ms)
        filter (where first_guess_ms is not null),
      'guessedShare', round(avg(case when guessed then 1 else 0 end), 3)
    ) as v
    from sessions
  ),

  -- Visits by hour of day. In Mountain Time because that is when drops turn
  -- over for the people who run the game, and one clock has to be picked.
  hours as (
    select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'visits', coalesce(c.visits, 0))
      order by h.hour), '[]'::jsonb) as v
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from created_at at time zone 'America/Denver')::int as hour, count(*) as visits
      from events where name = 'site_visit'
      group by 1
    ) c on c.hour = h.hour
  )

  select jsonb_build_object(
    'asOf', (select as_of from bounds),
    'windowDays', (select n from days),
    'totals', (select v from totals),
    'daily', (select v from daily),
    'retention', (select v from retention),
    'cohorts', (select v from cohorts),
    'weekday', (select v from weekday),
    'modes', (select v from modes),
    'depth', (select v from depth),
    'funnel', (select v from funnel),
    'sources', (select v from sources),
    'sessions', (select v from session_stats),
    'hours', (select v from hours)
  );
$$;

comment on function public.analytics_report(integer) is
  'Aggregate play, retention, weekday, mode, funnel and source numbers for the /analytics page, as one JSON document. Read by api/review.ts.';

-- Explicit, for the reason every recent migration gives: service_role does not
-- inherit what public is given, and a clean stack grants it nothing by default.
revoke all on function public.analytics_report(integer) from public, anon, authenticated;
grant execute on function public.analytics_report(integer) to service_role;
