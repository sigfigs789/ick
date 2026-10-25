-- /experimentsV2's window picker: analytics_v2_experiment (20261101100000)
-- takes the reader's window, p_from to p_to, and counts only the players drawn
-- in it. Without one it is the function it was: everyone drawn before today.
--
-- The window picks who is in the test, not which of their days count: a
-- player drawn on the window's last day is still followed to their day 1 and
-- day 7, as far as yesterday reaches. A window that ends today is today so far,
-- so today's draws are counted, and so are today's words, for them and for
-- everyone else drawn in it; no D1 is over for a player drawn today, so they
-- are in "Players drawn" and the guardrails but not the call.
--
-- Every other number, exclusion and segment is unchanged. The old
-- analytics_v2_experiment(date, text) is dropped so a two-argument call cannot
-- be ambiguous between it and the defaulted overload, and the grants are given
-- again for the new signature. The api checks the window (both ends or
-- neither, in order, no later than p_today) before it gets here.

drop function if exists public.analytics_v2_experiment(date, text);

create or replace function public.analytics_v2_experiment(
  p_today date,
  p_event text,
  p_from date default null,
  p_to date default null
)
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
  -- The draws counted, first to last, and the day after the last one whose
  -- words count: tomorrow for a window ending today, otherwise today.
  bounds as (
    select
      p_from as first_draw,
      coalesce(p_to, p_today - 1) as last_draw,
      case when p_to >= p_today then p_today + 1 else p_today end as until
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
    where r.day < (select until from bounds)
      and not exists (select 1 from excluded x where x.player_id = r.player_id)
  ),
  -- Each player's draw: the first, should a browser ever have sent two, and
  -- only when it falls in the window.
  assigned as materialized (
    select * from (
      select distinct on (r.player_id) r.player_id, r.variant, r.live_day as day
      from raw r
      where r.name = p_event
        and r.variant in ('shown', 'hidden')
        and r.live_day < (select until from bounds)
        and not exists (select 1 from excluded x where x.player_id = r.player_id)
      order by r.player_id, r.created_at
    ) first_draws, bounds b
    where (b.first_draw is null or first_draws.day >= b.first_draw)
      and first_draws.day <= b.last_draw
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
      where s.puzzle_date < (select until from bounds)
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

revoke all on function public.analytics_v2_experiment(date, text, date, date) from public, anon, authenticated;
grant execute on function public.analytics_v2_experiment(date, text, date, date) to service_role;

-- Unchanged, and given again so its call is checked against the new signature.
create or replace function public.analytics_v2_word_of_day(p_today date)
returns jsonb
language sql
stable
as $$
  select public.analytics_v2_experiment(p_today, 'word_of_day_assigned');
$$;
