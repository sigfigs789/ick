-- /analyticsV2's word of the day experiment (see src/game/wordOfDay.ts): half
-- of players see the word under a finished puzzle's drop, half never do. Each
-- player is drawn once, the first time they finish a puzzle, and reported as
-- one word_of_day_assigned event with a `variant` of `shown` or `hidden`.
--
-- Its own function rather than more of analytics_v2, so the dashboard's
-- day-on-day comparison (which reruns analytics_v2 for yesterday) does not run
-- it twice. Who is counted, and what a player, a day and a share are, follow
-- analytics_v2 (20261030100000_analytics_v2.sql) exactly, and so do the
-- exclusions: Muse, bots, Vercel arrivals, the maintainer and the hand-kept
-- list.
--
-- Every number is from the assignment day: the live puzzle the draw happened
-- on (`live_date`, since the finished puzzle can be an archived one), else the
-- day it arrived in Mountain Time. Per arm, twice -- everyone, and new players
-- alone (assigned on the day of their first word):
--   assigned     players drawn into the arm.
--   d1           banked a word exactly 1 day after, of those whose day 1 is over.
--   d7           the same on exactly day 7, the scorecard's D7.
--   week         banked a word on any of the 7 days after, and `days`, how many
--                of those days in all, over the same cohort.
--   playerDays   days they banked a word from the assignment day on, and
--                `sharedDays`, the ones they shared -- the scorecard's sharing.
--   laterDays    days they banked a word after the assignment day, and
--                `laterCompleted`, the ones they finished: whether hiding the
--                word changes finishing later puzzles.
-- p_today is left out as still filling up.

create or replace function public.analytics_v2_word_of_day(p_today date)
returns jsonb
language sql
stable
as $$
  with
  raw as materialized (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as day,
      case
        when e.props ->> 'live_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'live_date', 'date')
        then (e.props ->> 'live_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as live_day,
      e.created_at,
      e.props ->> 'variant' as variant,
      e.props ->> 'visitor' = 'mos-muse' as is_muse,
      e.name = 'site_visit'
        and (e.props ->> 'webdriver' = 'true' or e.props ->> 'bot_ua' = 'true'
          or e.props ->> 'server_bot_ua' = 'true') as is_bot,
      coalesce(e.props ->> 'source', '') ~* '(^|\.)vercel\.(com|app)$'
        or coalesce(e.props ->> 'last_source', '') ~* '(^|\.)vercel\.(com|app)$' as from_vercel
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
  ),
  excluded as materialized (
    select player_id from raw where is_muse or is_bot or from_vercel
    union
    -- NorthernBear87, the maintainer.
    select '87d3b6e1-322e-4928-acee-b4a7086c6e86'
    union
    select player_id from public.analytics_excluded_players
  ),
  ev as materialized (
    select r.* from raw r
    where r.day < p_today
      and not exists (select 1 from excluded x where x.player_id = r.player_id)
  ),
  -- Each player's draw: the first, should a browser ever have sent two.
  assigned as materialized (
    select distinct on (r.player_id) r.player_id, r.variant, r.live_day as day
    from raw r
    where r.name = 'word_of_day_assigned'
      and r.variant in ('shown', 'hidden')
      and r.live_day < p_today
      and not exists (select 1 from excluded x where x.player_id = r.player_id)
    order by r.player_id, r.created_at
  ),
  -- One row a player's day for the players in the test, with what they did.
  days as materialized (
    select player_id, day, bool_or(active) as active, bool_or(completed) as completed, bool_or(shared) as shared
    from (
      select
        e.player_id,
        e.day,
        e.name = 'answer_accepted' as active,
        e.name = 'puzzle_completed' as completed,
        e.name in ('result_copied', 'result_shared_on_x') as shared
      from ev e
      where e.player_id in (select player_id from assigned)
      union all
      select s.player_id::text, s.puzzle_date, true, false, false
      from public.leaderboard_scores s
      where s.puzzle_date < p_today
        and s.player_id::text in (select player_id from assigned)
    ) x
    group by 1, 2
  ),
  players as (
    select
      a.player_id,
      a.variant,
      a.day,
      (select min(d.day) from days d where d.player_id = a.player_id and d.active) = a.day as is_new,
      a.day + 1 < p_today as d1_over,
      a.day + 7 < p_today as d7_over,
      exists (select 1 from days d where d.player_id = a.player_id and d.active and d.day = a.day + 1) as d1,
      exists (select 1 from days d where d.player_id = a.player_id and d.active and d.day = a.day + 7) as d7,
      (select count(*) from days d
        where d.player_id = a.player_id and d.active and d.day between a.day + 1 and a.day + 7) as week_days,
      (select count(*) from days d where d.player_id = a.player_id and d.active and d.day >= a.day) as player_days,
      (select count(*) from days d
        where d.player_id = a.player_id and d.active and d.shared and d.day >= a.day) as shared_days,
      (select count(*) from days d where d.player_id = a.player_id and d.active and d.day > a.day) as later_days,
      (select count(*) from days d
        where d.player_id = a.player_id and d.active and d.completed and d.day > a.day) as later_completed
    from assigned a
  ),
  arms as (
    select
      p.variant,
      s.segment,
      jsonb_build_object(
        'variant', p.variant,
        'segment', s.segment,
        'assigned', count(*),
        'd1', jsonb_build_object('cohort', count(*) filter (where p.d1_over),
          'returned', count(*) filter (where p.d1_over and p.d1)),
        'd7', jsonb_build_object('cohort', count(*) filter (where p.d7_over),
          'returned', count(*) filter (where p.d7_over and p.d7)),
        'week', jsonb_build_object('cohort', count(*) filter (where p.d7_over),
          'returned', count(*) filter (where p.d7_over and p.week_days > 0),
          'days', coalesce(sum(p.week_days) filter (where p.d7_over), 0)),
        'playerDays', coalesce(sum(p.player_days), 0),
        'sharedDays', coalesce(sum(p.shared_days), 0),
        'laterDays', coalesce(sum(p.later_days), 0),
        'laterCompleted', coalesce(sum(p.later_completed), 0)
      ) as v
    from players p
      cross join lateral (
        select 'all' as segment
        union all
        select 'new' where p.is_new
      ) s
    group by 1, 2
  )

  select jsonb_build_object(
    'since', (select min(day) from assigned),
    'arms', (select coalesce(jsonb_agg(v order by variant desc, segment), '[]'::jsonb) from arms)
  );
$$;

-- Read through the service role only, like analytics_v2.
revoke all on function public.analytics_v2_word_of_day(date) from public, anon, authenticated;
grant execute on function public.analytics_v2_word_of_day(date) to service_role;
