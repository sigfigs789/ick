-- onboarding_report: how new players do in the mode they were started in.
--
-- A brand-new player starts in a mode picked by how they arrived (see
-- src/game/onboarding.ts), and the `mode_assigned` event says which and why:
--
--   shared   a friend's share link, which carries the mode it was shared from
--            (`?s=sh.f`, `?s=t.s`). They start where their friend is.
--   default  direct, or a share link from before links carried a mode. Standard.
--   split    any other identified source. Half Freeform, half Standard, at
--            random -- the one arm where the mode is the only difference, so the
--            one to read a Freeform-versus-Standard answer off.
--
-- Its own function, read alongside analytics_report by api/review.ts and set on
-- the report as `onboarding`, the same way chat_report is.
--
-- Each arm is every player assigned into it over the window, whether or not
-- they went on to bank a word -- an arm that loses more people before the first
-- word is doing worse, and counting only players would hide it. Everything after
-- the assignment is joined on `player_id`:
--
--   leaderboard_scores  the days they played, for retention. Live days only, the
--                       same as analytics_report's retention; any mode counts,
--                       so a player who switched and stayed is retained.
--   analytics_events    their shares (`result_copied`, `result_shared_on_x`) and
--                       whether they ever moved the switch (`mode_changed`).
--
-- Day N is the puzzle they arrived on plus N. A player is in the D1 cohort once
-- that day is over -- the same `first_day + 1 < as_of` rule analytics_report
-- uses -- and in the D7 and first-week cohorts once day 7 is.
--
-- `arrivals` is every tap on a share link, new player or not, by the mode the
-- link carried (`none` for a link from before). Scoped by the puzzle the event
-- names, which arrivals from before this change do not carry.
--
-- GitHub traffic is left out exactly as it is in analytics_report. Nothing
-- identifying leaves the function: counts, shares and averages.

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
  per_player as (
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
  'Retention and sharing of new players by the mode they were started in, for the /analytics page. Read by api/review.ts alongside analytics_report.';

revoke all on function public.onboarding_report(integer) from public, anon, authenticated;
grant execute on function public.onboarding_report(integer) to service_role;
