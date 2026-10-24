-- The analytics weeks run Monday to Sunday, the same week the weekly
-- leaderboard and the lazy weekend use, instead of Sunday to Saturday. That
-- moves every week in /analytics (weekly active and playing players, the
-- week's flow and days played, retention by arrival week) and /analyticsV2
-- (the week table and weekly cohorts). A week's `start` is now its Monday.
--
-- Postgres's extract(isodow) is 1 on a Monday and 7 on a Sunday, so
-- `d - (extract(isodow from d)::int - 1)` is the Monday on or before d; it
-- stands everywhere `d - extract(dow from d)::int`, the Sunday, did.
--
-- Unlike the leaderboard, these weeks have no 8-day switchover week: every
-- week, the past ones too, is simply recounted Monday to Sunday.
--
-- The functions are otherwise 20261030000000_analytics_weekly_playing.sql and
-- 20261030100000_analytics_v2.sql, whose notes stand; same signatures, so
-- replaces, and the grants are given again.

create or replace function public.analytics_overview(
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
  chart as (
    select
      case when b.win_start = b.win_end
        then least(b.win_end + 3, greatest(b.today, b.win_end)) - 6
        else b.win_start end as chart_start,
      case when b.win_start = b.win_end
        then least(b.win_end + 3, greatest(b.today, b.win_end))
        else b.win_end end as chart_end
    from bounds b
  ),

  arrivals as (
    select d.player_id, min(d.day) as first_day
    from player_days d
    group by 1
  ),
  -- The play-screen arm each player was drawn in, per experiment, first report
  -- wins.
  ui_arms as (
    select distinct on (player_id, experiment) player_id, experiment, variant, day
    from (
      select
        player_id,
        case
          when experiment in ('new', 'returning') then experiment
          when visit_type = 'first' then 'new'
          when visit_type = 'returning' then 'returning'
        end as experiment,
        variant,
        day,
        created_at
      from events
      where name = 'ui_variant_assigned'
        and variant in ('control', 'v2')
    ) a
    where experiment is not null
    order by player_id, experiment, created_at
  ),
  chat_days as (
    select distinct player_id, day from events where name = 'chat_opened'
  ),
  share_days as (
    select distinct player_id, day from events
    where name in ('result_copied', 'result_shared_on_x')
  ),
  completion_days as (
    select distinct player_id, day from events where name = 'puzzle_completed'
  ),

  -- Each player in the window, once.
  win_players as (
    select
      d.player_id,
      min(d.day) as anchor,
      max(d.level) as level,
      bool_or(c.player_id is not null) as chatted,
      bool_or(sh.player_id is not null) as shared,
      bool_or(cp.player_id is not null) as completed
    from player_days d
      cross join bounds b
      left join chat_days c on c.player_id = d.player_id and c.day = d.day
      left join share_days sh on sh.player_id = d.player_id and sh.day = d.day
      left join completion_days cp on cp.player_id = d.player_id and cp.day = d.day
    where d.day between b.win_start and b.win_end
    group by 1
  ),
  win_rows as (
    select
      w.player_id,
      w.level,
      w.chatted,
      w.shared,
      w.completed,
      a.first_day >= b.win_start as is_new,
      w.anchor + 7 < b.today as closed,
      exists (
        select 1 from player_days n
        where n.player_id = w.player_id and n.day > w.anchor and n.day <= w.anchor + 7
      ) as returned,
      w.anchor + 1 < b.today as next_closed,
      exists (
        select 1 from player_days n
        where n.player_id = w.player_id and n.day = w.anchor + 1
      ) as next_day
    from win_players w
      join arrivals a on a.player_id = w.player_id
      cross join bounds b
  ),
  win_grouped as (
    select g.grp, r.*
    from win_rows r
      cross join lateral (values
        ('all'), (case when r.is_new then 'new' else 'returning' end)) as g(grp)
  ),
  groups as (
    select coalesce(jsonb_object_agg(x.grp, x.v), '{}'::jsonb) as v
    from (
      select
        k.grp,
        jsonb_build_object(
          'players', count(r.player_id),
          'acted', count(r.player_id) filter (where r.level >= 2),
          'guessed', count(r.player_id) filter (where r.level = 3),
          'shared', count(r.player_id) filter (where r.shared),
          'completed', count(r.player_id) filter (where r.completed),
          'returned', jsonb_build_object(
            'cohort', count(r.player_id) filter (where r.closed),
            'returned', count(r.player_id) filter (where r.closed and r.returned),
            'soFar', count(r.player_id) filter (where r.returned),
            'guessers', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.level = 3 and r.closed),
              'returned', count(r.player_id) filter (where r.level = 3 and r.closed and r.returned),
              'soFar', count(r.player_id) filter (where r.level = 3 and r.returned))),
          'nextDay', jsonb_build_object(
            'cohort', count(r.player_id) filter (where r.next_closed),
            'returned', count(r.player_id) filter (where r.next_closed and r.next_day),
            'soFar', count(r.player_id) filter (where r.next_day),
            'guessers', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.level = 3 and r.next_closed),
              'returned', count(r.player_id) filter (where r.level = 3 and r.next_closed and r.next_day),
              'soFar', count(r.player_id) filter (where r.level = 3 and r.next_day)))
        ) as v
      from (values ('all'), ('new'), ('returning')) as k(grp)
        left join win_grouped r on r.grp = k.grp
      group by k.grp
    ) x
  ),
  chat as (
    select coalesce(jsonb_object_agg(x.grp, x.v), '{}'::jsonb) as v
    from (
      select
        k.grp,
        jsonb_object_agg(s.side, jsonb_build_object(
          'players', (select count(*) from win_grouped r
                      where r.grp = k.grp and r.chatted = s.chatted),
          'acted', (select count(*) from win_grouped r
                    where r.grp = k.grp and r.chatted = s.chatted and r.level >= 2),
          'guessed', (select count(*) from win_grouped r
                      where r.grp = k.grp and r.chatted = s.chatted and r.level = 3),
          'shared', (select count(*) from win_grouped r
                     where r.grp = k.grp and r.chatted = s.chatted and r.shared),
          'completed', (select count(*) from win_grouped r
                        where r.grp = k.grp and r.chatted = s.chatted and r.completed),
          'returned', jsonb_build_object(
            'cohort', (select count(*) from win_grouped r
                       where r.grp = k.grp and r.chatted = s.chatted and r.closed),
            'returned', (select count(*) from win_grouped r
                         where r.grp = k.grp and r.chatted = s.chatted and r.closed and r.returned),
            'soFar', (select count(*) from win_grouped r
                      where r.grp = k.grp and r.chatted = s.chatted and r.returned),
            'guessers', jsonb_build_object(
              'cohort', (select count(*) from win_grouped r
                         where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.closed),
              'returned', (select count(*) from win_grouped r
                           where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.closed and r.returned),
              'soFar', (select count(*) from win_grouped r
                        where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.returned))),
          'nextDay', jsonb_build_object(
            'cohort', (select count(*) from win_grouped r
                       where r.grp = k.grp and r.chatted = s.chatted and r.next_closed),
            'returned', (select count(*) from win_grouped r
                         where r.grp = k.grp and r.chatted = s.chatted and r.next_closed and r.next_day),
            'soFar', (select count(*) from win_grouped r
                      where r.grp = k.grp and r.chatted = s.chatted and r.next_day),
            'guessers', jsonb_build_object(
              'cohort', (select count(*) from win_grouped r
                         where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.next_closed),
              'returned', (select count(*) from win_grouped r
                           where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.next_closed and r.next_day),
              'soFar', (select count(*) from win_grouped r
                        where r.grp = k.grp and r.chatted = s.chatted and r.level = 3 and r.next_day)))
        )) as v
      from (values ('all'), ('new'), ('returning')) as k(grp)
        cross join (values ('opened', true), ('notOpened', false)) as s(side, chatted)
      group by k.grp
    ) x
  ),

  -- The play-screen test (see src/game/uiVariant.ts): each experiment's
  -- players in the window, by the arm they were drawn in, counting only the
  -- days that arm was on their screen -- the first session's day for new, the
  -- draw on for returning.
  ui_players as (
    select
      u.experiment as grp,
      d.player_id,
      u.variant,
      min(d.day) as anchor,
      max(d.level) as level,
      bool_or(sh.player_id is not null) as shared,
      bool_or(cp.player_id is not null) as completed
    from player_days d
      join ui_arms u on u.player_id = d.player_id
        and (d.day = u.day or (u.experiment = 'returning' and d.day > u.day))
      cross join bounds b
      left join share_days sh on sh.player_id = d.player_id and sh.day = d.day
      left join completion_days cp on cp.player_id = d.player_id and cp.day = d.day
    where d.day between b.win_start and b.win_end
    group by 1, 2, 3
  ),
  ui_rows as (
    select
      p.grp,
      p.player_id,
      p.variant,
      p.anchor,
      p.level,
      p.shared,
      p.completed,
      p.anchor + 7 < b.today as closed,
      exists (
        select 1 from player_days n
        where n.player_id = p.player_id and n.day > p.anchor and n.day <= p.anchor + 7
      ) as returned,
      p.anchor + 1 < b.today as next_closed,
      exists (
        select 1 from player_days n
        where n.player_id = p.player_id and n.day = p.anchor + 1
      ) as next_day
    from ui_players p
      cross join bounds b
  ),
  ui_grouped as (
    select grp, player_id, variant, level, shared, completed, closed, returned, next_closed, next_day
    from ui_rows
    union all
    (select distinct on (player_id)
       'all', player_id, variant, level, shared, completed, closed, returned, next_closed, next_day
     from ui_rows
     order by player_id, anchor, grp)
  ),
  ui as (
    select coalesce(jsonb_object_agg(y.grp, y.v), '{}'::jsonb) as v
    from (
      select x.grp, jsonb_object_agg(x.variant, x.v) as v
      from (
        select
          k.grp,
          s.variant,
          jsonb_build_object(
            'players', count(r.player_id),
            'acted', count(r.player_id) filter (where r.level >= 2),
            'guessed', count(r.player_id) filter (where r.level = 3),
            'shared', count(r.player_id) filter (where r.shared),
            'completed', count(r.player_id) filter (where r.completed),
            'returned', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.closed),
              'returned', count(r.player_id) filter (where r.closed and r.returned),
              'soFar', count(r.player_id) filter (where r.returned),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.closed and r.returned),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.returned))),
            'nextDay', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.next_closed),
              'returned', count(r.player_id) filter (where r.next_closed and r.next_day),
              'soFar', count(r.player_id) filter (where r.next_day),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.next_closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.next_closed and r.next_day),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.next_day)))
          ) as v
        from (values ('all'), ('new'), ('returning')) as k(grp)
          cross join (values ('control'), ('v2')) as s(variant)
          left join ui_grouped r on r.grp = k.grp and r.variant = s.variant
        group by k.grp, s.variant
      ) x
      group by x.grp
    ) y
  ),

  -- The idle hint test (see src/game/idleHint.ts): the players who sat idle
  -- long enough to be hinted in the window, in either arm, by the arm they were
  -- in. New and returning here are the test's own two experiments (a first-ever
  -- session, and any later one); everyone is each player's first trigger in
  -- the window. The numbers are the window's own, as everywhere else.
  idle_triggers as (
    select distinct on (e.props ->> 'player_id', e.props ->> 'experiment')
      e.props ->> 'player_id' as player_id,
      e.props ->> 'experiment' as experiment,
      e.props ->> 'variant' as variant,
      e.created_at
    from public.analytics_events e
      cross join bounds b
    where e.name = 'idle_hint_triggered'
      and e.props ->> 'player_id' is not null
      and e.props ->> 'experiment' in ('new', 'returning')
      and e.props ->> 'variant' in ('control', 'treatment')
      and e.props ->> 'live_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_input_is_valid(e.props ->> 'live_date', 'date')
      and (e.props ->> 'live_date')::date between b.win_start and b.win_end
      and not exists (
        select 1 from excluded_players g where g.player_id = e.props ->> 'player_id')
    order by e.props ->> 'player_id', e.props ->> 'experiment', e.created_at
  ),
  idle_rows as (
    select i.grp, i.variant, r.*
    from (
      select experiment as grp, variant, player_id from idle_triggers
      union all
      (select distinct on (player_id) 'all', variant, player_id
       from idle_triggers
       order by player_id, created_at)
    ) i
      join win_rows r on r.player_id = i.player_id
  ),
  idle_hint as (
    select coalesce(jsonb_object_agg(y.grp, y.v), '{}'::jsonb) as v
    from (
      select x.grp, jsonb_object_agg(x.variant, x.v) as v
      from (
        select
          k.grp,
          s.variant,
          jsonb_build_object(
            'players', count(r.player_id),
            'acted', count(r.player_id) filter (where r.level >= 2),
            'guessed', count(r.player_id) filter (where r.level = 3),
            'shared', count(r.player_id) filter (where r.shared),
            'completed', count(r.player_id) filter (where r.completed),
            'returned', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.closed),
              'returned', count(r.player_id) filter (where r.closed and r.returned),
              'soFar', count(r.player_id) filter (where r.returned),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.closed and r.returned),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.returned))),
            'nextDay', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.next_closed),
              'returned', count(r.player_id) filter (where r.next_closed and r.next_day),
              'soFar', count(r.player_id) filter (where r.next_day),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.next_closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.next_closed and r.next_day),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.next_day)))
          ) as v
        from (values ('all'), ('new'), ('returning')) as k(grp)
          cross join (values ('control'), ('treatment')) as s(variant)
          left join idle_rows r on r.grp = k.grp and r.variant = s.variant
        group by k.grp, s.variant
      ) x
      group by x.grp
    ) y
  ),

  -- By puzzle type (see the note at the top): every mode each player's day
  -- shows, by the board, the switch or the events that name one.
  mode_seen as (
    select player_id, day, mode, created_at from events
    where name in ('mode_assigned', 'puzzle_completed', 'result_copied')
      and mode in ('standard', 'freeform')
    union all
    select player_id, day, to_mode, created_at from events
    where name = 'mode_changed' and to_mode in ('standard', 'freeform')
    union all
    select player_id, day, mode, null from plays
  ),
  -- Each player's modes on each day in the window: the ones the day shows,
  -- else the one last shown since the choice began, else the default.
  mode_days as (
    select distinct s.player_id, s.day, s.mode
    from mode_seen s
      cross join bounds b
    where s.day between b.win_start and b.win_end
    union
    select
      d.player_id,
      d.day,
      case
        when d.day >= date '2026-09-27' then coalesce((
          select s.mode from mode_seen s
          where s.player_id = d.player_id and s.day >= date '2026-09-27' and s.day < d.day
          order by s.day desc, s.created_at desc nulls last
          limit 1), 'standard')
        when d.day >= date '2026-09-14' then 'freeform'
        else 'standard'
      end
    from player_days d
      cross join bounds b
    where d.day between b.win_start and b.win_end
      and not exists (
        select 1 from mode_seen s where s.player_id = d.player_id and s.day = d.day)
  ),
  -- Each player in the window, by the modes their days were in: one of them,
  -- or both.
  mode_types as (
    select
      m.player_id,
      case when count(distinct m.mode) > 1 then 'both' else min(m.mode) end as type
    from mode_days m
      join player_days d on d.player_id = m.player_id and d.day = m.day
    group by 1
  ),
  mode_grouped as (
    select g.grp, t.type, r.*
    from win_rows r
      join mode_types t on t.player_id = r.player_id
      cross join lateral (values
        ('all'), (case when r.is_new then 'new' else 'returning' end)) as g(grp)
  ),
  modes as (
    select coalesce(jsonb_object_agg(y.grp, y.v), '{}'::jsonb) as v
    from (
      select x.grp, jsonb_object_agg(x.type, x.v) as v
      from (
        select
          k.grp,
          s.type,
          jsonb_build_object(
            'players', count(r.player_id),
            'acted', count(r.player_id) filter (where r.level >= 2),
            'guessed', count(r.player_id) filter (where r.level = 3),
            'shared', count(r.player_id) filter (where r.shared),
            'completed', count(r.player_id) filter (where r.completed),
            'returned', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.closed),
              'returned', count(r.player_id) filter (where r.closed and r.returned),
              'soFar', count(r.player_id) filter (where r.returned),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.closed and r.returned),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.returned))),
            'nextDay', jsonb_build_object(
              'cohort', count(r.player_id) filter (where r.next_closed),
              'returned', count(r.player_id) filter (where r.next_closed and r.next_day),
              'soFar', count(r.player_id) filter (where r.next_day),
              'guessers', jsonb_build_object(
                'cohort', count(r.player_id) filter (where r.level = 3 and r.next_closed),
                'returned', count(r.player_id) filter (where r.level = 3 and r.next_closed and r.next_day),
                'soFar', count(r.player_id) filter (where r.level = 3 and r.next_day)))
          ) as v
        from (values ('all'), ('new'), ('returning')) as k(grp)
          cross join (values ('standard'), ('freeform'), ('both')) as s(type)
          left join mode_grouped r on r.grp = k.grp and r.type = s.type
        group by k.grp, s.type
      ) x
      group by x.grp
    ) y
  ),

  -- One row per puzzle in the chart, a day nobody turned up included.
  day_rows as (
    select
      d.day,
      d.player_id,
      d.level,
      a.first_day = d.day as is_new,
      exists (
        select 1 from share_days sh where sh.player_id = d.player_id and sh.day = d.day
      ) as shared,
      exists (
        select 1 from completion_days cp where cp.player_id = d.player_id and cp.day = d.day
      ) as completed,
      exists (
        select 1 from player_days n
        where n.player_id = d.player_id and n.day > d.day and n.day <= d.day + 7
      ) as returned,
      exists (
        select 1 from player_days n
        where n.player_id = d.player_id and n.day = d.day + 1
      ) as next_day
    from player_days d
      join arrivals a on a.player_id = d.player_id
      cross join chart c
    where d.day between c.chart_start and c.chart_end
  ),
  day_grouped as (
    select g.grp, r.*
    from day_rows r
      cross join lateral (values
        ('all'), (case when r.is_new then 'new' else 'returning' end)) as g(grp)
  ),
  chart_days as (
    select gs::date as day
    from chart c, bounds b,
      generate_series(greatest(c.chart_start, b.first_day), c.chart_end, interval '1 day') gs
    where b.first_day is not null
  ),
  day_counts as (
    select
      s.day,
      k.grp,
      jsonb_build_object(
        'players', count(r.player_id),
        'acted', count(r.player_id) filter (where r.level >= 2),
        'guessed', count(r.player_id) filter (where r.level = 3),
        'shared', count(r.player_id) filter (where r.shared),
        'completed', count(r.player_id) filter (where r.completed),
        'returned', count(r.player_id) filter (where r.returned),
        'nextDay', count(r.player_id) filter (where r.next_day)
      ) as v
    from chart_days s
      cross join (values ('all'), ('new'), ('returning')) as k(grp)
      left join day_grouped r on r.grp = k.grp and r.day = s.day
    group by 1, 2
  ),
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'closed', d.day + 7 < b.today,
      'groups', d.groups
    ) order by d.day), '[]'::jsonb) as v
    from (select day, jsonb_object_agg(grp, v) as groups from day_counts group by day) d,
      bounds b
  ),

  -- Weekly active players, newest week first (see the note at the top).
  weeks as (
    -- extract(isodow) is 1 on a Monday, so this is the Monday on or before today.
    select k, w.monday - 7 * k as week_start, w.monday - 7 * k + 6 as week_end
    from (select b.today - (extract(isodow from b.today)::int - 1) as monday, b.first_day from bounds b) w,
      generate_series(0, 12) as k
    where w.first_day is not null and w.monday - 7 * k + 6 >= w.first_day
  ),
  week_counts as (
    select
      w.week_start,
      w.week_end,
      count(distinct d.player_id) as players,
      count(distinct d.player_id) filter (where a.first_day >= w.week_start) as new_players,
      count(distinct d.player_id) filter (where a.first_day < w.week_start) as returning_players
    from weeks w
      left join player_days d on d.day between w.week_start and w.week_end
      left join arrivals a on a.player_id = d.player_id
    group by 1, 2
  ),
  -- The Monday of every week each player turned up in.
  player_weeks as (
    select distinct d.player_id, d.day - (extract(isodow from d.day)::int - 1) as monday
    from player_days d
  ),
  -- Where each week's players came from, and who of the week before was lost.
  week_flow as (
    select
      w.week_start,
      count(pw.player_id) filter (where a.first_day < w.week_start and prev.player_id is not null) as kept,
      count(pw.player_id) filter (where a.first_day < w.week_start and prev.player_id is null) as resurrected,
      count(pw.player_id) filter (
        where a.first_day < w.week_start and prev.player_id is null and nxt.player_id is not null
      ) as resurrected_stayed,
      (select count(*) from player_weeks l
       where l.monday = w.week_start - 7
         and not exists (
           select 1 from player_weeks t where t.player_id = l.player_id and t.monday = w.week_start)
      ) as lost
    from weeks w
      left join player_weeks pw on pw.monday = w.week_start
      left join arrivals a on a.player_id = pw.player_id
      left join player_weeks prev on prev.player_id = pw.player_id and prev.monday = w.week_start - 7
      left join player_weeks nxt on nxt.player_id = pw.player_id and nxt.monday = w.week_start + 7
    group by 1
  ),
  -- How many of the week's puzzles each player banked a word in.
  week_play_days as (
    select w.week_start, p.player_id, count(distinct p.day) as days
    from weeks w
      join plays p on p.day between w.week_start and w.week_end
    group by 1, 2
  ),
  week_played as (
    select
      w.week_start,
      count(p.player_id) filter (where p.days = 1) as one_day,
      count(p.player_id) filter (where p.days between 2 and 3) as two_to_three,
      count(p.player_id) filter (where p.days >= 4) as four_plus,
      count(p.player_id) as playing,
      count(p.player_id) filter (where a.first_day >= w.week_start) as playing_new,
      count(p.player_id) filter (where a.first_day < w.week_start) as playing_returning
    from weeks w
      left join week_play_days p on p.week_start = w.week_start
      left join arrivals a on a.player_id = p.player_id
    group by 1
  ),
  weekly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', w.week_start,
      'end', w.week_end,
      'groups', jsonb_build_object(
        'all', w.players,
        'new', w.new_players,
        'returning', w.returning_players),
      'playing', jsonb_build_object(
        'all', p.playing,
        'new', p.playing_new,
        'returning', p.playing_returning),
      'flow', jsonb_build_object(
        'new', w.new_players,
        'kept', f.kept,
        'resurrected', f.resurrected,
        'resurrectedStayed', f.resurrected_stayed,
        'lost', f.lost),
      'nextWeekOver', w.week_end + 7 < b.today,
      'played', jsonb_build_object(
        'oneDay', p.one_day,
        'twoToThree', p.two_to_three,
        'fourPlus', p.four_plus)
    ) order by w.week_end desc), '[]'::jsonb) as v
    from week_counts w
      join week_flow f on f.week_start = w.week_start
      join week_played p on p.week_start = w.week_start
      cross join bounds b
  ),

  -- Retention by the week players arrived (see the note at the top).
  cohort_players as (
    select
      c.player_id,
      c.cohort,
      exists (
        select 1 from plays p
        where p.player_id = c.player_id and p.day between c.cohort and c.cohort + 6
      ) as guessed
    from (
      select a.player_id, a.first_day - (extract(isodow from a.first_day)::int - 1) as cohort
      from arrivals a
    ) c
  ),
  cohort_cells as (
    select
      c.cohort,
      (pw.monday - c.cohort) / 7 as k,
      count(*) as players,
      count(*) filter (where c.guessed) as guessers
    from cohort_players c
      join player_weeks pw on pw.player_id = c.player_id and pw.monday > c.cohort
    group by 1, 2
  ),
  cohorts as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', s.cohort,
      'players', s.players,
      'guessers', s.guessers,
      'weeks', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'players', coalesce(x.players, 0),
          'guessers', coalesce(x.guessers, 0)
        ) order by g.k), '[]'::jsonb)
        from generate_series(1, (s.this_monday - s.cohort) / 7) as g(k)
          left join cohort_cells x on x.cohort = s.cohort and x.k = g.k)
    ) order by s.cohort desc), '[]'::jsonb) as v
    from (
      select
        c.cohort,
        b.today - (extract(isodow from b.today)::int - 1) as this_monday,
        count(*) as players,
        count(*) filter (where c.guessed) as guessers
      from cohort_players c
        cross join bounds b
      group by 1, 2
    ) s
    where s.cohort >= s.this_monday - 7 * 12
  ),

  -- Each player's first-touch source: the one their first site_visit carried.
  first_sources as (
    select distinct on (e.props ->> 'player_id')
      e.props ->> 'player_id' as player_id,
      coalesce(nullif(e.props ->> 'source', ''), 'direct') as source
    from public.analytics_events e
    where e.name = 'site_visit'
      and e.props ->> 'player_id' is not null
    order by e.props ->> 'player_id', e.created_at
  ),
  sources as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', x.source,
      'players', x.players,
      'guessed', x.guessed,
      'returned', jsonb_build_object(
        'cohort', x.closed,
        'returned', x.returned,
        'soFar', x.so_far)
    ) order by x.players desc, x.source), '[]'::jsonb) as v
    from (
      select
        coalesce(s.source, 'direct') as source,
        count(*) as players,
        count(*) filter (where r.level = 3) as guessed,
        count(*) filter (where r.closed) as closed,
        count(*) filter (where r.closed and r.returned) as returned,
        count(*) filter (where r.returned) as so_far
      from win_rows r
        left join first_sources s on s.player_id = r.player_id
      where r.is_new
      group by 1
    ) x
  ),

  -- Muse AI's events, by the puzzle each one belongs to.
  muse_events as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as day,
      e.created_at
    from public.analytics_events e
      join muse_players m on m.player_id = e.props ->> 'player_id'
    where e.name in ('site_visit', 'answer_rejected', 'chat_opened', 'chat_message_sent')
  ),
  muse_win as (
    select m.*
    from muse_events m
      cross join bounds b
    where m.day between coalesce(b.win_start, m.day) and coalesce(b.win_end, m.day)
  ),
  -- A puzzle Muse played is a board row: a browser, a date, a mode, with the
  -- total and the words it banked -- the rows the players' Guessed is read from.
  muse_puzzles as (
    select s.player_id::text as player_id, s.puzzle_date as day, s.total_score as score, s.words
    from public.leaderboard_scores s
      join muse_players m on m.player_id = s.player_id::text
      cross join bounds b
    where s.puzzle_date between coalesce(b.win_start, s.puzzle_date) and coalesce(b.win_end, s.puzzle_date)
  ),
  muse_days as (
    select
      d.day,
      (select count(*) from muse_win w where w.day = d.day and w.name = 'site_visit') as visits,
      (select count(*) from muse_puzzles p where p.day = d.day) as puzzles,
      (select round(avg(p.score), 2) from muse_puzzles p where p.day = d.day) as avg_score,
      (select round(avg(p.words), 2) from muse_puzzles p where p.day = d.day) as avg_words,
      (select round((select count(*) from muse_win w where w.day = d.day and w.name = 'answer_rejected')
        / nullif((select count(*) from muse_puzzles p where p.day = d.day), 0)::numeric, 2)) as avg_rejected,
      exists (select 1 from muse_win w where w.day = d.day and w.name = 'chat_opened') as chat_opened,
      (select count(*) from muse_win w where w.day = d.day and w.name = 'chat_message_sent') as messages
    from (select day from muse_win union select day from muse_puzzles) d
  ),
  -- The same numbers per bot: each Muse browser that played in the window.
  muse_bots as (
    select
      b.player_id,
      (select count(*) from muse_win w where w.player_id = b.player_id and w.name = 'site_visit') as visits,
      (select count(*) from muse_puzzles p where p.player_id = b.player_id) as puzzles,
      (select round(avg(p.score), 2) from muse_puzzles p where p.player_id = b.player_id) as avg_score,
      (select round(avg(p.words), 2) from muse_puzzles p where p.player_id = b.player_id) as avg_words,
      (select round((select count(*) from muse_win w where w.player_id = b.player_id and w.name = 'answer_rejected')
        / nullif((select count(*) from muse_puzzles p where p.player_id = b.player_id), 0)::numeric, 2)) as avg_rejected,
      (select count(distinct w.day) from muse_win w where w.player_id = b.player_id and w.name = 'chat_opened') as chat_days,
      (select count(*) from muse_win w where w.player_id = b.player_id and w.name = 'chat_message_sent') as messages,
      (select min(w.created_at) from muse_win w where w.player_id = b.player_id) as first_seen,
      (select max(w.created_at) from muse_win w where w.player_id = b.player_id) as last_seen
    from (select player_id from muse_win union select player_id from muse_puzzles) b
  ),
  muse as (
    select jsonb_build_object(
      'visits', (select count(*) from muse_win where name = 'site_visit'),
      'browsers', (select count(distinct player_id) from muse_win),
      'puzzles', (select count(*) from muse_puzzles),
      'avgScore', (select round(avg(score), 2) from muse_puzzles),
      'avgWords', (select round(avg(words), 2) from muse_puzzles),
      -- A rejection's own mode is the date's, not the one played, so tries are
      -- counted by day and spread over that window's puzzles.
      'avgRejected', (select round((select count(*) from muse_win where name = 'answer_rejected')
        / nullif((select count(*) from muse_puzzles), 0)::numeric, 2)),
      'chatDays', (select count(*) from muse_days where chat_opened),
      'messages', (select count(*) from muse_win where name = 'chat_message_sent'),
      'firstSeen', (select min(created_at) from muse_events),
      'lastSeen', (select max(created_at) from muse_events),
      'days', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', day,
        'visits', visits,
        'puzzles', puzzles,
        'avgScore', avg_score,
        'avgWords', avg_words,
        'avgRejected', avg_rejected,
        'chatOpened', chat_opened,
        'messages', messages
      ) order by day desc), '[]'::jsonb) from muse_days),
      'bots', (select coalesce(jsonb_agg(jsonb_build_object(
        'playerId', player_id,
        'visits', visits,
        'puzzles', puzzles,
        'avgScore', avg_score,
        'avgWords', avg_words,
        'avgRejected', avg_rejected,
        'chatDays', chat_days,
        'messages', messages,
        'firstSeen', first_seen,
        'lastSeen', last_seen
      ) order by last_seen desc nulls last, player_id), '[]'::jsonb) from muse_bots)
    ) as v
  )

  select jsonb_build_object(
    'today', (select today from bounds),
    'firstDay', (select first_day from bounds),
    'from', (select win_start from bounds),
    'to', (select win_end from bounds),
    'groups', (select v from groups),
    'modes', (select v from modes),
    'chat', (select v from chat),
    'chatSince', (select min(day) from chat_days),
    'ui', (select v from ui),
    'uiSince', (select min(e.day) from events e where e.name = 'ui_variant_assigned'),
    'idleHint', (select v from idle_hint),
    'idleHintSince', (
      select min((e.props ->> 'live_date')::date)
      from public.analytics_events e
      where e.name = 'idle_hint_triggered'
        and e.props ->> 'live_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and pg_input_is_valid(e.props ->> 'live_date', 'date')),
    'daily', (select v from daily),
    'weekly', (select v from weekly),
    'cohorts', (select v from cohorts),
    'sources', (select v from sources),
    'muse', (select v from muse),
    'botsFiltered', (
      select count(*)
      from bot_players p
        join first_visits f on f.player_id = p.player_id
        cross join bounds b
      where f.day between b.win_start and b.win_end
        and not exists (select 1 from muse_players m where m.player_id = p.player_id))
  );
$$;

comment on function public.analytics_overview(date, date, date) is
  'Players, players who acted, guessed, shared, completed a puzzle, came back the next day and returned within 7 days -- by new/returning, puzzle type (Standard, Freeform or both, by new/returning), chat, play-screen arm (by its own new/returning experiments) and idle hint arm, with Muse AI apart and by bot; weekly active and playing players by new/returning for the latest 13 Monday-to-Sunday weeks, with each week''s new/kept/resurrected/lost players and days played; retention by arrival week; and the window''s new players by source -- for the /analytics page, as one JSON document, with automated visits dropped and counted in botsFiltered. Read by api/review.ts.';

-- Explicit: service_role does not inherit what public is given, and a clean
-- stack grants it nothing by default.
revoke all on function public.analytics_overview(date, date, date) from public, anon, authenticated;
grant execute on function public.analytics_overview(date, date, date) to service_role;

create or replace function public.analytics_v2(p_today date)
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
      e.created_at,
      e.props ->> 'source' as source,
      e.props ->> 'best_rarity' as best_rarity,
      e.props ->> 'best_score' as best_score,
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
    where r.day <= p_today
      and not exists (select 1 from excluded x where x.player_id = r.player_id)
  ),
  board as materialized (
    select distinct s.player_id::text as player_id, s.puzzle_date as day
    from public.leaderboard_scores s
    where s.puzzle_date <= p_today
      and not exists (select 1 from excluded x where x.player_id = s.player_id::text)
  ),

  -- One row a visitor's day, with what they did on it.
  days as materialized (
    select
      player_id,
      day,
      bool_or(active) as active,
      bool_or(started) as started,
      bool_or(completed) as completed,
      bool_or(shared) as shared,
      sum(board_opens)::int as board_opens,
      bool_or(share_arrival) as share_arrival
    from (
      select
        player_id,
        day,
        name = 'answer_accepted' as active,
        name in ('answer_accepted', 'answer_rejected') as started,
        name = 'puzzle_completed' as completed,
        name in ('result_copied', 'result_shared_on_x') as shared,
        (name = 'leaderboard_opened')::int as board_opens,
        name in ('arrived_from_share', 'arrived_from_twitter') as share_arrival
      from ev
      union all
      select player_id, day, true, true, false, false, 0, false from board
    ) x
    group by 1, 2
  ),
  -- Each visitor: their first day, the first day they banked a word (if
  -- ever), and where their first visit came from.
  visitors as materialized (
    select
      d.player_id,
      min(d.day) as first_seen,
      min(d.day) filter (where d.active) as first_active,
      coalesce(fs.source, 'unknown') as source
    from days d
      left join (
        select distinct on (player_id) player_id, nullif(source, '') as source
        from ev
        where name = 'site_visit'
        order by player_id, created_at
      ) fs using (player_id)
    group by d.player_id, fs.source
  ),
  -- Each visitor's day, with whether they were seen, and played, the next day
  -- and within the next seven.
  followed as materialized (
    select
      d.*,
      v.first_seen,
      v.first_active,
      n.player_id is not null as seen_next,
      coalesce(n.active, false) as played_next,
      exists (
        select 1 from days w
        where w.player_id = d.player_id and w.active and w.day between d.day + 1 and d.day + 7
      ) as played_week
    from days d
      join visitors v using (player_id)
      left join days n on n.player_id = d.player_id and n.day = d.day + 1
    where d.day >= p_today - 84
  ),

  -- The last 84 days, today included, one row a day.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', g.day,
      'visitors', coalesce(x.visitors, 0),
      'newVisitors', coalesce(x.new_visitors, 0),
      'players', coalesce(x.players, 0),
      'newPlayers', coalesce(x.new_players, 0)
    ) order by g.day), '[]'::jsonb) as v
    from (select gs::date as day from generate_series(p_today - 83, p_today, interval '1 day') gs) g
      left join (
        select
          day,
          count(*) as visitors,
          count(*) filter (where day = first_seen) as new_visitors,
          count(*) filter (where active) as players,
          count(*) filter (where day = first_active) as new_players
        from followed
        group by 1
      ) x using (day)
  ),

  -- Day N retention, two ways. Players: of those whose first word was in the
  -- 28 days up to the last one with day N over, the share who banked a word
  -- on exactly day N. Visitors: the same over first visits, back meaning seen.
  retention as (
    select jsonb_object_agg('d' || x.n, jsonb_build_object(
      'players', jsonb_build_object('cohort', x.p_cohort, 'returned', x.p_back),
      'visitors', jsonb_build_object('cohort', x.v_cohort, 'returned', x.v_back)
    )) as v
    from (
      select
        t.n,
        count(*) filter (where v.first_active between p_today - t.n - 28 and p_today - t.n - 1) as p_cohort,
        count(*) filter (where v.first_active between p_today - t.n - 28 and p_today - t.n - 1
          and pa.player_id is not null) as p_back,
        count(*) filter (where v.first_seen between p_today - t.n - 28 and p_today - t.n - 1) as v_cohort,
        count(*) filter (where v.first_seen between p_today - t.n - 28 and p_today - t.n - 1
          and vs.player_id is not null) as v_back
      from (values (1), (7), (30)) as t(n)
        cross join visitors v
        left join days pa on pa.player_id = v.player_id and pa.day = v.first_active + t.n and pa.active
        left join days vs on vs.player_id = v.player_id and vs.day = v.first_seen + t.n
      group by t.n
    ) x
  ),

  -- Weeks, Monday to Sunday: the current one (still counting) and the eleven
  -- before it.
  weeks as (
    select p_today - (extract(isodow from p_today)::int - 1) - 7 * k as start
    from generate_series(0, 11) k
  ),
  -- Weekly player cohorts: the players whose first word was in a week, and how
  -- many banked a word in each later week that is over.
  cohort_cells as (
    select
      c.start,
      (a.week - c.start) / 7 as k,
      count(distinct a.player_id) as players
    from (
      select player_id, first_active - (extract(isodow from first_active)::int - 1) as start
      from visitors where first_active is not null
    ) c
      join (
        select player_id, day - (extract(isodow from day)::int - 1) as week
        from days where active
      ) a on a.player_id = c.player_id and a.week > c.start
    group by 1, 2
  ),
  cohorts as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', w.start,
      'players', (select count(*) from visitors v
        where v.first_active between w.start and w.start + 6),
      'weeks', (
        select coalesce(jsonb_agg(coalesce(cc.players, 0) order by k.k), '[]'::jsonb)
        from generate_series(1, 8) k(k)
          left join cohort_cells cc on cc.start = w.start and cc.k = k.k
        where w.start + 7 * k.k + 6 < p_today
      )
    ) order by w.start desc), '[]'::jsonb) as v
    from weeks w
  ),

  -- Weekly players: everyone who banked a word in the week, the ones whose
  -- first word it was, the week's visitors, and how many of its days each
  -- player played.
  week_players as (
    select w.start, f.player_id, count(*) filter (where f.active) as days_played, min(f.first_active) as first_active
    from weeks w
      join followed f on f.day between w.start and w.start + 6
    group by 1, 2
  ),
  weekly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', w.start,
      'visitors', (select count(*) from week_players p where p.start = w.start),
      'players', (select count(*) from week_players p where p.start = w.start and p.days_played > 0),
      'newPlayers', (select count(*) from week_players p
        where p.start = w.start and p.first_active between w.start and w.start + 6),
      'daysPlayed', (select coalesce(jsonb_object_agg(x.n, x.c), '{}'::jsonb) from (
        select p.days_played as n, count(*) as c from week_players p
        where p.start = w.start and p.days_played > 0 group by 1) x)
    ) order by w.start desc), '[]'::jsonb) as v
    from weeks w
  ),

  -- Where new visitors came from, by first visit: the last 28 closed days
  -- against the 28 before, and how many of each became players.
  sources as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', x.source, 'recent', x.recent, 'prior', x.prior,
      'recentPlayers', x.recent_players, 'priorPlayers', x.prior_players
    ) order by x.recent desc, x.prior desc), '[]'::jsonb) as v
    from (
      select
        v.source,
        count(*) filter (where v.first_seen between p_today - 28 and p_today - 1) as recent,
        count(*) filter (where v.first_seen between p_today - 56 and p_today - 29) as prior,
        count(*) filter (where v.first_seen between p_today - 28 and p_today - 1 and v.first_active is not null) as recent_players,
        count(*) filter (where v.first_seen between p_today - 56 and p_today - 29 and v.first_active is not null) as prior_players
      from visitors v
      where v.first_seen between p_today - 56 and p_today - 1
      group by 1
    ) x
  ),

  -- The last 28 closed days.
  window_numbers as (
    select jsonb_build_object(
      'visitors', count(distinct f.player_id),
      'firstVisits', count(*) filter (where f.day = f.first_seen),
      'firstVisitStarted', count(*) filter (where f.day = f.first_seen and f.started),
      'firstVisitPlayed', count(*) filter (where f.day = f.first_seen and f.active),
      'players', count(distinct f.player_id) filter (where f.active),
      'visitorDays', count(*),
      'startedDays', count(*) filter (where f.started),
      'playerDays', count(*) filter (where f.active),
      'completedDays', count(*) filter (where f.active and f.completed),
      'sharedDays', count(*) filter (where f.active and f.shared),
      'completedSharedDays', count(*) filter (where f.active and f.completed and f.shared),
      'sharers', count(distinct f.player_id) filter (where f.active and f.shared),
      'boardViewers', count(distinct f.player_id) filter (where f.active and f.board_opens > 0),
      'boardViewDays', count(*) filter (where f.active and f.board_opens > 0),
      'boardOpens', coalesce(sum(f.board_opens) filter (where f.active), 0),
      'referralVisits', count(*) filter (where f.share_arrival),
      'referralNewVisitors', count(*) filter (where f.day = f.first_seen and f.source_share),
      'referralNewPlayers', count(*) filter (where f.day = f.first_seen and f.source_share and f.first_active is not null),
      -- From a player's day, the share who banked a word again the next day
      -- and within a week, split by what they did that day.
      'afterBoard', jsonb_build_object(
        'viewed', jsonb_build_object(
          'cohort', count(*) filter (where f.active and f.next_over and f.board_opens > 0),
          'returned', count(*) filter (where f.active and f.next_over and f.board_opens > 0 and f.played_next)),
        'notViewed', jsonb_build_object(
          'cohort', count(*) filter (where f.active and f.next_over and f.board_opens = 0),
          'returned', count(*) filter (where f.active and f.next_over and f.board_opens = 0 and f.played_next))),
      'afterShare', jsonb_build_object(
        'shared', jsonb_build_object(
          'cohort', count(*) filter (where f.active and f.next_over and f.shared),
          'returned', count(*) filter (where f.active and f.next_over and f.shared and f.played_next),
          'weekCohort', count(*) filter (where f.active and f.week_over and f.shared),
          'weekReturned', count(*) filter (where f.active and f.week_over and f.shared and f.played_week)),
        'notShared', jsonb_build_object(
          'cohort', count(*) filter (where f.active and f.next_over and not f.shared),
          'returned', count(*) filter (where f.active and f.next_over and not f.shared and f.played_next),
          'weekCohort', count(*) filter (where f.active and f.week_over and not f.shared),
          'weekReturned', count(*) filter (where f.active and f.week_over and not f.shared and f.played_week)))
    ) as v
    from (
      select
        f.*,
        f.day + 1 < p_today as next_over,
        f.day + 7 < p_today as week_over,
        v.source in ('share', 't') as source_share
      from followed f
        join visitors v using (player_id)
      where f.day between p_today - 28 and p_today - 1
    ) f
  ),

  -- Finished puzzles over the last 28 closed days, a player's day once on its
  -- best score.
  finishes as (
    select distinct on (player_id, day)
      player_id,
      day,
      coalesce(nullif(best_rarity, ''), 'None') as tier,
      case when best_score ~ '^-?[0-9]+(\.[0-9]+)?$' then best_score::numeric end as score
    from ev
    where name = 'puzzle_completed' and day between p_today - 28 and p_today - 1
    order by player_id, day,
      case when best_score ~ '^-?[0-9]+(\.[0-9]+)?$' then best_score::numeric end desc nulls last
  ),
  scores as (
    select jsonb_build_object(
      'tiers', (select coalesce(jsonb_agg(jsonb_build_object(
          'tier', t.tier, 'finished', t.finished, 'shared', t.shared, 'cohort', t.cohort, 'returned', t.returned
        ) order by t.finished desc), '[]'::jsonb)
        from (
          select
            fi.tier,
            count(*) as finished,
            count(*) filter (where fo.shared) as shared,
            count(*) filter (where fi.day + 1 < p_today) as cohort,
            count(*) filter (where fi.day + 1 < p_today and fo.played_next) as returned
          from finishes fi
            join followed fo on fo.player_id = fi.player_id and fo.day = fi.day
          group by 1
        ) t),
      -- Best scores in whole-point buckets, 0 to 10.
      'buckets', (select coalesce(jsonb_object_agg(b, c), '{}'::jsonb) from (
        select least(greatest(floor(score)::int, 0), 10) as b, count(*) as c
        from finishes where score is not null group by 1) x)
    ) as v
  )

  select jsonb_build_object(
    'today', p_today,
    'trackedSince', (select min(day) from ev where name = 'site_visit'),
    'daily', (select v from daily),
    'retention', (select v from retention),
    'cohorts', (select v from cohorts),
    'weekly', (select v from weekly),
    'sources', (select v from sources),
    'window', (select v from window_numbers),
    'scores', (select v from scores)
  );
$$;

-- Read through the service role only, like the other report functions: revoke
-- the defaults and grant service_role explicitly, since a new function on the
-- hosted stack grants it nothing by default.
revoke all on function public.analytics_v2(date) from public, anon, authenticated;
grant execute on function public.analytics_v2(date) to service_role;
