-- Weekly active players by calendar week, Sunday to Saturday, instead of
-- seven puzzles ending on today's. The latest week is the one today's puzzle
-- falls in, so it is still counting up and only as long as the days it has had;
-- the 13 weeks run back from it, or to the week of the first day if that is
-- fewer. `start` is the Sunday and `end` the Saturday, even while the latest
-- Saturday is still to come.
--
-- The function is otherwise 20261027000000_analytics_weekly_active_players.sql,
-- whose notes stand; same signature, so a replace, and the grant is given
-- again.

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
                     'ui_variant_assigned', 'result_copied', 'result_shared_on_x')
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
                                                           'result_copied', 'result_shared_on_x')
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

  -- By puzzle type: who banked a word in each mode, and came back.
  mode_firsts as (
    select p.mode, p.player_id, min(p.day) as anchor
    from plays p
      cross join bounds b
    where p.day between b.win_start and b.win_end
    group by 1, 2
  ),
  mode_rows as (
    select
      m.mode,
      m.player_id,
      m.anchor + 7 < b.today as closed,
      exists (
        select 1 from player_days n
        where n.player_id = m.player_id and n.day > m.anchor and n.day <= m.anchor + 7
      ) as returned
    from mode_firsts m
      cross join bounds b
  ),
  modes as (
    select coalesce(jsonb_object_agg(k.mode, jsonb_build_object(
      'guessed', (select count(*) from mode_rows r where r.mode = k.mode),
      'returned', jsonb_build_object(
        'cohort', (select count(*) from mode_rows r where r.mode = k.mode and r.closed),
        'returned', (select count(*) from mode_rows r where r.mode = k.mode and r.closed and r.returned),
        'soFar', (select count(*) from mode_rows r where r.mode = k.mode and r.returned))
    )), '{}'::jsonb) as v
    from (values ('standard'), ('freeform')) as k(mode)
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
  -- extract(dow) is 0 on a Sunday, so this is the Sunday on or before today.
  weeks as (
    select k, w.sunday - 7 * k as week_start, w.sunday - 7 * k + 6 as week_end
    from (select b.today - extract(dow from b.today)::int as sunday, b.first_day from bounds b) w,
      generate_series(0, 12) as k
    where w.first_day is not null and w.sunday - 7 * k + 6 >= w.first_day
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
  weekly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', w.week_start,
      'end', w.week_end,
      'groups', jsonb_build_object(
        'all', w.players,
        'new', w.new_players,
        'returning', w.returning_players)
    ) order by w.week_end desc), '[]'::jsonb) as v
    from week_counts w
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
  'Players, players who acted, guessed, shared, completed a puzzle, came back the next day and returned within 7 days -- by new/returning, puzzle type, chat, play-screen arm (by its own new/returning experiments) and idle hint arm, with Muse AI apart and by bot, and weekly active players by new/returning for the latest 13 Sunday-to-Saturday weeks -- for the /analytics page, as one JSON document, with automated visits dropped and counted in botsFiltered. Read by api/review.ts.';

-- Explicit: service_role does not inherit what public is given, and a clean
-- stack grants it nothing by default.
revoke all on function public.analytics_overview(date, date, date) from public, anon, authenticated;
grant execute on function public.analytics_overview(date, date, date) to service_role;
