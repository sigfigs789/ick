-- onboarding_report gains returning players: a Standard and a Freeform row
-- beside the new-player arms, so the page can set how the people already here
-- do in each mode against how new arrivals do.
--
-- A returning player is anyone who played a live day before the window began
-- and played again inside it. They have no `mode_assigned` -- that fires once,
-- for a brand-new browser -- so they are counted in each mode they played in
-- the window, and a player who played both is in both rows. Assigning each to
-- one mode hid Freeform entirely: every returner who plays it plays Standard
-- too, and came back on Standard first. A day from before the split is
-- 'shared' and says nothing about a choice, so it counts toward neither row.
-- Day N counts from their first play in that mode in the window, the way it
-- counts from the arrival day for new players, with the same cohort rule, but
-- only a later day in that same mode is retention -- in either mode, the
-- Freeform row would mostly be the Standard play of the same people. Played is
-- everyone by construction.
--
-- Their shares and switches are only the ones from that day on: a returner may
-- have moved the switch in August, and that is not something this window did.
-- Events before 2026-09-30 carry no puzzle, so those fall back to receipt date.
--
-- Same signature, so a replace; the grant is given again anyway (see
-- 20260930020000 -- service_role does not inherit).
--
-- The rest is 20260930020000_onboarding_report.sql, whose notes stand.

create or replace function public.onboarding_report(p_days integer default 60)
returns jsonb
language sql
stable
as $$
  with
  days as (select greatest(7, least(coalesce(p_days, 60), 365)) as n),
  bounds as (
    select max(puzzle_date) as as_of from public.leaderboard_scores
  ),
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  -- One assignment per player, the first: the client sends it once per browser,
  -- and a duplicate would be a replayed request rather than a second start.
  -- The date is checked before it is cast, as everywhere else: the endpoint is
  -- public, and one malformed row must not take the report down.
  assigned as (
    select distinct on (e.props ->> 'player_id')
      e.props ->> 'player_id' as player_id,
      e.props ->> 'mode' as mode,
      e.props ->> 'reason' as reason,
      (e.props ->> 'puzzle_date')::date as day
    from public.analytics_events e
    where e.name = 'mode_assigned'
      and e.props ->> 'player_id' is not null
      and e.props ->> 'mode' in ('standard', 'freeform')
      and e.props ->> 'reason' in ('shared', 'default', 'split')
      and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
    order by e.props ->> 'player_id', e.created_at
  ),
  cohort as (
    select a.*
    from assigned a, bounds b, days
    where a.day > b.as_of - days.n
  ),
  plays as (
    select distinct c.player_id, s.puzzle_date
    from cohort c
      join public.leaderboard_scores s
        on s.player_id::text = c.player_id and s.puzzle_date >= c.day
  ),
  shares as (
    select e.props ->> 'player_id' as player_id, count(*) as n
    from public.analytics_events e
      join cohort c on c.player_id = e.props ->> 'player_id'
    where e.name in ('result_copied', 'result_shared_on_x')
    group by 1
  ),
  switchers as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
      join cohort c on c.player_id = e.props ->> 'player_id'
    where e.name = 'mode_changed'
  ),
  -- Returning players: a live day before the window, and one inside it.
  returner_firsts as (
    select s.player_id::text as player_id, min(s.puzzle_date) as first_day
    from public.leaderboard_scores s
    where not exists (
      select 1 from github_players g where g.player_id = s.player_id::text)
    group by 1
  ),
  returning_cohort as (
    select
      s.player_id::text as player_id,
      s.mode,
      'returning'::text as reason,
      min(s.puzzle_date) as day
    from public.leaderboard_scores s
      join returner_firsts f on f.player_id = s.player_id::text,
      bounds b, days
    where s.mode in ('standard', 'freeform')
      and s.puzzle_date > b.as_of - days.n
      and f.first_day <= b.as_of - days.n
    group by 1, 2
  ),
  returning_plays as (
    select distinct r.player_id, r.mode, s.puzzle_date
    from returning_cohort r
      join public.leaderboard_scores s
        on s.player_id::text = r.player_id and s.puzzle_date >= r.day
  ),
  -- The date an event belongs to: its puzzle, or before puzzles were stamped on
  -- events, the day it was received.
  returning_events as (
    select e.name, r.player_id, r.mode
    from public.analytics_events e
      join returning_cohort r on r.player_id = e.props ->> 'player_id'
    where e.name in ('result_copied', 'result_shared_on_x', 'mode_changed')
      and case
            when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
            then (e.props ->> 'puzzle_date')::date
            else e.created_at::date
          end >= r.day
  ),
  returning_per_player as (
    select
      r.reason,
      r.mode,
      r.day,
      (select count(*) from returning_plays p where p.player_id = r.player_id and p.mode = r.mode) as days_played,
      exists (select 1 from returning_plays p
              where p.player_id = r.player_id and p.mode = r.mode and p.puzzle_date = r.day + 1) as d1,
      exists (select 1 from returning_plays p
              where p.player_id = r.player_id and p.mode = r.mode and p.puzzle_date = r.day + 7) as d7,
      exists (select 1 from returning_plays p
              where p.player_id = r.player_id and p.mode = r.mode
                and p.puzzle_date > r.day and p.puzzle_date <= r.day + 7) as week1,
      (select count(*) from returning_events e
       where e.player_id = r.player_id and e.mode = r.mode and e.name <> 'mode_changed') as shares,
      exists (select 1 from returning_events e
              where e.player_id = r.player_id and e.mode = r.mode and e.name = 'mode_changed') as switched
    from returning_cohort r
  ),
  new_per_player as (
    select
      c.reason,
      c.mode,
      c.day,
      (select count(*) from plays p where p.player_id = c.player_id) as days_played,
      exists (select 1 from plays p
              where p.player_id = c.player_id and p.puzzle_date = c.day + 1) as d1,
      exists (select 1 from plays p
              where p.player_id = c.player_id and p.puzzle_date = c.day + 7) as d7,
      exists (select 1 from plays p
              where p.player_id = c.player_id
                and p.puzzle_date > c.day and p.puzzle_date <= c.day + 7) as week1,
      coalesce((select n from shares s where s.player_id = c.player_id), 0) as shares,
      exists (select 1 from switchers w where w.player_id = c.player_id) as switched
    from cohort c
  ),
  per_player as (
    select * from new_per_player
    union all
    select * from returning_per_player
  ),
  arms as (
    select coalesce(jsonb_agg(a.v order by a.reason, a.mode), '[]'::jsonb) as v
    from (
      select
        p.reason,
        p.mode,
        jsonb_build_object(
          'reason', p.reason,
          'mode', p.mode,
          'players', count(*),
          'played', count(*) filter (where p.days_played > 0),
          'playedDays', sum(p.days_played),
          'avgDaysPlayed', round(avg(p.days_played), 2),
          'd1', jsonb_build_object(
            'cohort', count(*) filter (where p.day + 1 < b.as_of),
            'returned', count(*) filter (where p.day + 1 < b.as_of and p.d1)),
          'd7', jsonb_build_object(
            'cohort', count(*) filter (where p.day + 7 < b.as_of),
            'returned', count(*) filter (where p.day + 7 < b.as_of and p.d7)),
          'week1', jsonb_build_object(
            'cohort', count(*) filter (where p.day + 7 < b.as_of),
            'returned', count(*) filter (where p.day + 7 < b.as_of and p.week1)),
          'sharers', count(*) filter (where p.shares > 0),
          'shares', sum(p.shares),
          'switched', count(*) filter (where p.switched)
        ) as v
      from per_player p, bounds b
      group by p.reason, p.mode
    ) a
  ),
  arrivals as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'link', x.link, 'mode', x.mode, 'arrivals', x.n
    ) order by x.link, x.mode), '[]'::jsonb) as v
    from (
      select
        case when e.name = 'arrived_from_share' then 'share' else 'twitter' end as link,
        coalesce(e.props ->> 'mode', 'none') as mode,
        count(*) as n
      from public.analytics_events e, bounds b, days
      where e.name in ('arrived_from_share', 'arrived_from_twitter')
        and e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        and (e.props ->> 'puzzle_date')::date > b.as_of - days.n
        and not exists (
          select 1 from github_players g where g.player_id = e.props ->> 'player_id')
      group by 1, 2
    ) x
  )

  select jsonb_build_object(
    'since', (select min(day) from assigned),
    'arms', (select v from arms),
    'arrivals', (select v from arrivals)
  );
$$;

comment on function public.onboarding_report(integer) is
  'Retention and sharing of new players by the mode they were started in, and of returning players by the mode they came back to, for the /analytics page. Read by api/review.ts alongside analytics_report.';

revoke all on function public.onboarding_report(integer) from public, anon, authenticated;
grant execute on function public.onboarding_report(integer) to service_role;
