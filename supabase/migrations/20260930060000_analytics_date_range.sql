-- (Numbered 20260930060000: 20260930050000 is analytics_visitors, #376.)
--
-- /analytics gains a picked calendar range, and DAU/MAU stickiness.
--
-- A range is sent as the window it already speaks: `p_days` is its width and
-- `p_date` its last day. Until now `p_date` only meant anything in the today
-- window; from here it sets where every window ends, and with it a width of 2
-- to 6 is allowed as well. The presets send no date, so they are exactly as
-- they were. Signatures are unchanged, so both functions are replaced in place.
--
-- `window.dauMau` is stickiness as it is usually reported: each puzzle's
-- players over the 30 puzzles ending on it, averaged over the window. The
-- tile it replaces divided by the window's own players, which made the
-- number mean something different at every width.
--
-- The bodies are otherwise 20260930050000_analytics_visitors.sql (the report)
-- and 20260930030000_analytics_today_window.sql (chat_report), whose notes
-- stand.

create or replace function public.analytics_report(p_days integer default 60, p_date date default null)
returns jsonb
language sql
stable
as $$
  with
  -- A window of 1 is today: the one puzzle `p_date` names, which is the
  -- viewer's own calendar date. A preset is 7 to 365 puzzles, as before. With a
  -- `p_date`, any width from 1 to 365 ending there: a picked calendar range.
  days as (
    select case when p_date is not null and p_days between 1 and 365 then p_days
      when p_days = 1 then 1 else greatest(7, least(coalesce(p_days, 60), 365)) end as n
  ),
  -- Browsers that ever arrived from GitHub. That traffic is the people building
  -- the game clicking through from a pull request, not players, so everything
  -- such a browser did is left out of every number below -- its plays, its
  -- visits, its sessions -- and not only the visit that carried the referrer.
  -- The source is the referrer's bare host (see referrerSource in
  -- src/game/visits.ts), or `github` from a `utm_source`.
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
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
    where not exists (
      select 1 from github_players g where g.player_id = s.player_id::text)
    -- A player may hold both a Standard and a Freeform row for one day from the
    -- split on. Both are real play and both count toward that mode's numbers;
    -- the per-player-per-day questions below collapse them with `distinct`.
  ),
  -- The last puzzle with anybody on it. Everything is measured up to here rather
  -- than to the server's clock, because "today" is the puzzle the players are on
  -- and the players are spread across time zones.
  --
  -- `win_end` is where the windowed series stop: the same latest puzzle, unless
  -- the page sent a date -- the viewer's puzzle in the today window, which can
  -- be a day behind or ahead of the latest anybody is on, or the last day of a
  -- picked range.
  bounds as (
    select
      max(puzzle_date) as as_of,
      coalesce(p_date, max(puzzle_date)) as win_end
    from plays
  ),
  player_days as (
    select distinct player_id, puzzle_date from plays
  ),
  firsts as (
    select player_id, min(puzzle_date) as first_day, count(*) as days_played
    from player_days
    group by player_id
  ),
  -- Every player who opened the leaderboard or the found words, and the live
  -- puzzle they opened it on. Scoped by the puzzle the event names, never by
  -- when it arrived: "today" is the puzzle the player is on.
  looks as (
    select distinct
      e.props ->> 'player_id' as player_id,
      (e.props ->> 'puzzle_date')::date as puzzle_date
    from public.analytics_events e
    where e.name in ('leaderboard_opened', 'found_words_opened')
      and e.props ->> 'player_id' is not null
      -- The endpoint is public, so a date is checked before it is cast: one
      -- malformed row must not be able to take the whole report down.
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  -- The looks that came with no banked word on that puzzle, in either mode.
  -- A player who looked and then played is a player, and is counted once, as
  -- one; these are the rest.
  lookers as (
    select l.player_id, l.puzzle_date
    from looks l
    where not exists (
      select 1 from player_days d
      where d.player_id::text = l.player_id and d.puzzle_date = l.puzzle_date)
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
      'firstDay', (select min(puzzle_date) from plays),
      'lookersToday', (select count(distinct player_id) from lookers, bounds
                       where puzzle_date = as_of),
      'lookersLast7', (select count(distinct player_id) from lookers, bounds
                       where puzzle_date > as_of - 7 and puzzle_date <= as_of),
      -- Looked at some point and have never banked a word at all: the people the
      -- play half has no row for.
      'lookersNeverPlayed', (select count(distinct l.player_id) from looks l
                             where not exists (
                               select 1 from firsts f where f.player_id::text = l.player_id)),
      'lookersSince', (select min(puzzle_date) from looks)
    ) as v
  ),

  -- The same puzzles the daily series spans -- the last `n` up to `win_end`,
  -- but none before the first anybody played -- so every headline tile counts
  -- over the window the page has picked, and a tile and the chart under it
  -- always cover the same days.
  win as (
    select
      greatest(b.win_end - ((select n from days) - 1), (select min(puzzle_date) from plays)) as win_start,
      b.win_end
    from bounds b
  ),
  win_players as (
    select d.player_id, count(*) as days_played
    from player_days d, win w
    where d.puzzle_date between w.win_start and w.win_end
    group by d.player_id
  ),
  window_totals as (
    select jsonb_build_object(
      'puzzles', (select (win_end - win_start) + 1 from win),
      'players', (select count(*) from win_players),
      -- Whose first puzzle ever is in the window: new to the game, not merely
      -- new to these days.
      'newPlayers', (select count(*) from firsts f, win w
                     where f.first_day between w.win_start and w.win_end),
      'avgDaysPerPlayer', (select round(avg(days_played), 2) from win_players),
      -- The average puzzle's players, over the whole window's: how much of the
      -- window's crowd a typical day sees.
      'avgDailyPlayers', (select round(sum(days_played)::numeric / nullif((win_end - win_start) + 1, 0), 2)
                          from win_players, win group by win_end, win_start),
      'lookers', (select count(distinct l.player_id) from lookers l, win w
                  where l.puzzle_date between w.win_start and w.win_end),
      -- DAU/MAU: each puzzle's players over the players of the 30 puzzles
      -- ending on it, averaged across the window. The denominator is always
      -- 30 puzzles, whatever the window, so the ratio means the same thing at
      -- every width and can be set beside anybody else's. Puzzles after the
      -- latest anybody played are left out rather than counted as zeros.
      'dauMau', (select round(avg(x.dau::numeric / x.mau), 4) from (
                   select
                     (select count(*) from player_days d where d.puzzle_date = g.day) as dau,
                     (select count(distinct d.player_id) from player_days d
                      where d.puzzle_date between g.day - 29 and g.day) as mau
                   from win w, bounds b,
                     lateral (select gs::date as day from generate_series(
                       w.win_start, least(w.win_end, b.as_of), interval '1 day') gs) g
                 ) x where x.mau > 0),
      -- The window's first and last puzzle, as the report counted them.
      'from', (select win_start from win),
      'to', (select win_end from win)
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
      'freeform', coalesce(a.freeform, 0),
      'lookers', coalesce(l.lookers, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (
      select gs::date as day
      from bounds b, days,
        generate_series(
          greatest(b.win_end - (days.n - 1), (select min(puzzle_date) from plays)),
          b.win_end, interval '1 day') as gs
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
      left join (
        select puzzle_date, count(distinct player_id) as lookers from lookers group by puzzle_date
      ) l on l.puzzle_date = g.day
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
  -- by server receipt time -- most event rows have no puzzle to scope them by.
  -- The today window is the exception: it is one puzzle, not a span of clock,
  -- so it reads the events stamped with that puzzle's date (the visit, session,
  -- share and mode events carry `puzzle_date` from 2026-09-30; see
  -- src/analytics.ts), and a row from before that is not counted in it at all.
  -- The receipt-time bound stays, three days wide, only so the scan is cheap:
  -- a puzzle is live for at most two days across the world's time zones.
  --
  -- A picked range of more than one day is receipt time too, but over those
  -- calendar days in Mountain Time -- the zone the hours chart reads in --
  -- rather than the last `n` days up to now. One day picked is read the way
  -- today is, by the puzzle stamp.
  events as (
    select e.name, e.props, e.created_at
    from public.analytics_events e, days
    where (case when days.n > 1 and p_date is not null
             then e.created_at >= ((select win_start from win)::timestamp at time zone 'America/Denver')
              and e.created_at < ((p_date + 1)::timestamp at time zone 'America/Denver')
             else e.created_at >= now() - make_interval(days => greatest(days.n, 3))
                  - case when p_date is not null then make_interval(days => greatest(current_date - p_date, 0)) else interval '0' end
           end)
      and (days.n > 1 or e.props ->> 'puzzle_date' = (select win_end::text from bounds))
      and e.name in ('site_visit', 'visit_engaged', 'puzzle_completed',
                     'result_copied', 'result_shared_on_x', 'session_time', 'mode_changed')
      -- GitHub traffic, twice over: a row that carries the source itself (which
      -- catches the rows from before events had a player id), and any row from a
      -- browser that ever arrived that way, since most events carry no source.
      and coalesce(e.props ->> 'source', '') !~ '(^|\.)github(\.com|\.io)?$'
      and coalesce(e.props ->> 'last_source', '') !~ '(^|\.)github(\.com|\.io)?$'
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),

  funnel as (
    select jsonb_build_object(
      'visits', count(*) filter (where name = 'site_visit'),
      'visitors', count(distinct props ->> 'player_id') filter (where name = 'site_visit'),
      'visitsWithId', count(*) filter (where name = 'site_visit' and props ->> 'player_id' is not null),
      'firstVisits', count(*) filter (where name = 'site_visit' and props ->> 'visit_type' = 'first'),
      'engaged', count(*) filter (where name = 'visit_engaged'),
      'engagedByLooking', count(*) filter (
        where name = 'visit_engaged' and props ->> 'via' in ('leaderboard', 'found_words')),
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
      'visitors', s.visitors,
      'firstVisits', s.first_visits,
      'engaged', s.engaged
    ) order by s.visits desc), '[]'::jsonb) as v
    from (
      select
        coalesce(props ->> 'source', 'direct') as source,
        count(*) filter (where name = 'site_visit') as visits,
        count(distinct props ->> 'player_id') filter (where name = 'site_visit') as visitors,
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
      bool_or((props ->> 'shared') = 'true') as shared,
      bool_or((props ->> 'looked') = 'true') as looked,
      -- Sessions from before `looked` was reported cannot say either way, so the
      -- share below is taken over the ones that can.
      bool_or(props ? 'looked') as reports_looked
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
      'guessedShare', round(avg(case when guessed then 1 else 0 end), 3),
      'lookedOnly', count(*) filter (where looked and not guessed),
      'lookedOnlyShare', round(avg(case when looked and not guessed then 1 else 0 end)
        filter (where reports_looked), 3)
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
    -- The earliest puzzle a visit event is stamped with, so the page can say
    -- when the today window's visit numbers begin.
    'visitsSince', (select min(e.props ->> 'puzzle_date') from public.analytics_events e
                    where e.name = 'site_visit'
                      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    -- The day the first visit carrying a player id arrived: where the distinct
    -- visitor counts begin. By receipt, since ids reached the visit rows before
    -- puzzle dates did.
    'visitorsSince', (select min(e.created_at)::date from public.analytics_events e
                      where e.name = 'site_visit' and e.props ->> 'player_id' is not null),
    'windowDays', (select n from days),
    'totals', (select v from totals),
    'window', (select v from window_totals),
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

comment on function public.analytics_report(integer, date) is
  'Aggregate play, look-only, retention, weekday, mode, funnel, visitor and source numbers for the /analytics page, as one JSON document. Read by api/review.ts.';

-- Explicit, for the reason every recent migration gives: service_role does not
-- inherit what public is given, and a clean stack grants it nothing by default.
revoke all on function public.analytics_report(integer, date) from public, anon, authenticated;
grant execute on function public.analytics_report(integer, date) to service_role;

create or replace function public.chat_report(p_days integer default 60, p_date date default null)
returns jsonb
language sql
stable
as $$
  with
  days as (
    select case when p_date is not null and p_days between 1 and 365 then p_days
      when p_days = 1 then 1 else greatest(7, least(coalesce(p_days, 60), 365)) end as n
  ),
  -- The window's last puzzle: the latest anybody played, or in the today
  -- window the viewer's own, as analytics_report's `win_end`.
  bounds as (
    select coalesce(p_date, max(puzzle_date)) as as_of
    from public.leaderboard_scores
  ),
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  -- Every chat event in the window, with its puzzle date read safely: the
  -- endpoint is public, and one malformed row must not take the report down.
  events as (
    select
      e.name,
      e.props,
      e.props ->> 'player_id' as player_id,
      e.props ->> 'view_id' as view_id,
      (e.props ->> 'puzzle_date')::date as puzzle_date
    from public.analytics_events e, bounds b, days
    where e.name in ('chat_opened', 'chat_time', 'chat_message_sent', 'chat_message_blocked')
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
      and (e.props ->> 'puzzle_date')::date > b.as_of - days.n
      and (e.props ->> 'puzzle_date')::date <= b.as_of
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  -- One row per opening of the panel, at its final running total -- chat_time
  -- reports more than once for a view that is backgrounded and resumed.
  views as (
    select
      view_id,
      max(puzzle_date) as puzzle_date,
      max((props ->> 'visible_ms')::numeric) as visible_ms,
      max((props ->> 'sent')::numeric) as sent
    from events
    where name = 'chat_time' and view_id is not null
      and jsonb_typeof(props -> 'visible_ms') = 'number'
    group by view_id
  ),
  -- Players, and whether each ever sent, for the share who talk rather than read.
  people as (
    select
      player_id,
      bool_or(name = 'chat_message_sent') as sent
    from events
    where player_id is not null and name in ('chat_opened', 'chat_message_sent')
    group by player_id
  ),

  totals as (
    select jsonb_build_object(
      'opens', (select count(*) from events where name = 'chat_opened'),
      'viewers', (select count(distinct player_id) from events where name = 'chat_opened'),
      'senders', (select count(distinct player_id) from events where name = 'chat_message_sent'),
      'messages', (select count(*) from events where name = 'chat_message_sent'),
      'blocked', (select count(*) from events where name = 'chat_message_blocked'),
      'blockedProfane', (select count(*) from events
                         where name = 'chat_message_blocked' and props ->> 'reason' = 'profane'),
      'blockedRateLimited', (select count(*) from events
                             where name = 'chat_message_blocked' and props ->> 'reason' = 'rate-limited'),
      'viewersToday', (select count(distinct player_id) from events, bounds
                       where name = 'chat_opened' and puzzle_date = as_of),
      'sendersToday', (select count(distinct player_id) from events, bounds
                       where name = 'chat_message_sent' and puzzle_date = as_of),
      'messagesToday', (select count(*) from events, bounds
                        where name = 'chat_message_sent' and puzzle_date = as_of),
      'viewersLast7', (select count(distinct player_id) from events, bounds
                       where name = 'chat_opened' and puzzle_date > as_of - 7),
      'sendersLast7', (select count(distinct player_id) from events, bounds
                       where name = 'chat_message_sent' and puzzle_date > as_of - 7),
      -- Viewers who came back to the chat on more than one puzzle.
      'returningViewers', (select count(*) from (
                             select player_id from events
                             where name = 'chat_opened' and player_id is not null
                             group by player_id having count(distinct puzzle_date) > 1) r),
      'senderShare', (select round(avg(case when sent then 1 else 0 end), 3) from people),
      'avgOpensPerViewer', (select round(count(*)::numeric / nullif(count(distinct player_id), 0), 2)
                            from events where name = 'chat_opened'),
      'avgMessageLength', (select round(avg((props ->> 'length')::numeric), 1) from events
                           where name = 'chat_message_sent'
                             and jsonb_typeof(props -> 'length') = 'number'),
      'since', (select min(puzzle_date) from events where name = 'chat_opened')
    ) as v
  ),

  time_stats as (
    select jsonb_build_object(
      'views', count(*),
      'medianViewMs', percentile_cont(0.5) within group (order by visible_ms),
      'avgViewMs', round(avg(visible_ms)),
      'totalMs', sum(visible_ms),
      'medianSendingViewMs', percentile_cont(0.5) within group (order by visible_ms)
        filter (where sent > 0),
      'sendingViewShare', round(avg(case when sent > 0 then 1 else 0 end), 3)
    ) as v
    from views
  ),

  -- One row per puzzle from the first chat event on: before it there is only a
  -- flat line of zeros for a feature that did not exist.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', g.day,
      'viewers', coalesce(a.viewers, 0),
      'senders', coalesce(a.senders, 0),
      'opens', coalesce(a.opens, 0),
      'messages', coalesce(a.messages, 0),
      'totalMs', coalesce(t.total_ms, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (
      select gs::date as day
      from bounds b, days,
        generate_series(
          greatest(b.as_of - (days.n - 1), (select min(puzzle_date) from events)),
          b.as_of, interval '1 day') as gs
      where b.as_of is not null and exists (select 1 from events)
    ) g
      left join (
        select puzzle_date,
          count(distinct player_id) filter (where name = 'chat_opened') as viewers,
          count(distinct player_id) filter (where name = 'chat_message_sent') as senders,
          count(*) filter (where name = 'chat_opened') as opens,
          count(*) filter (where name = 'chat_message_sent') as messages
        from events group by puzzle_date
      ) a on a.puzzle_date = g.day
      left join (
        select puzzle_date, sum(visible_ms) as total_ms from views group by puzzle_date
      ) t on t.puzzle_date = g.day
  ),

  -- The room as it stands, all time. Hidden messages are counted apart: they
  -- were posted, and how many had to be taken down is its own number.
  room as (
    select jsonb_build_object(
      'messages', count(*) filter (where not c.hidden),
      'hidden', count(*) filter (where c.hidden),
      'senders', count(distinct c.player_id),
      'last24h', count(*) filter (where not c.hidden and c.created_at > now() - interval '24 hours'),
      'firstAt', min(c.created_at),
      'lastAt', max(c.created_at)
    ) as v
    from public.chat_messages c
    where not exists (select 1 from github_players g where g.player_id = c.player_id)
  )

  select jsonb_build_object(
    'totals', (select v from totals),
    'time', (select v from time_stats),
    'daily', (select v from daily),
    'room', (select v from room)
  );
$$;

comment on function public.chat_report(integer, date) is
  'Chat views, time, senders, messages and blocks for the /analytics page, as one JSON document. Read by api/review.ts alongside analytics_report.';

revoke all on function public.chat_report(integer, date) from public, anon, authenticated;
grant execute on function public.chat_report(integer, date) to service_role;
