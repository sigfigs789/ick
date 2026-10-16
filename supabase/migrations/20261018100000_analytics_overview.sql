-- The /analytics page starts over: four key numbers, split by who the players
-- are, by the puzzle type they played, and by whether they opened the chat.
-- Everything else the page showed is gone, and so is its reading of
-- `analytics_report` and the six reports beside it (api/review.ts). Those
-- functions are left in place, unread, so a deploy of either side alone breaks
-- nothing; dropping them is its own change.
--
-- The four numbers, each a count of distinct players on a puzzle:
--
--   players   turned up: opened the game on the web (`site_visit`), did
--             anything below, or banked a word. The app and the Reddit post
--             build with reporting off, so their players count only once they
--             bank a word.
--   acted     did anything: a press of any button or key (`visit_interacted`,
--             from 2026-10-06), a guess or a look (`visit_engaged`), opened the
--             leaderboard, the found words or the chat, switched mode, finished
--             or shared -- or banked a word.
--   guessed   banked a word: a row on the board's table, in either mode.
--   returned  turned up again on any of the seven puzzles after. Counted only
--             once all seven are over (`d + 7 < today`), so a recent day is a
--             floor, and the window's rate is over the players whose seven
--             days have closed. `soFar` beside it counts every return seen
--             yet, closed or not, for a window too recent to have a rate.
--
-- A player's day is the puzzle an event names. Events from before 2026-09-30
-- carry no puzzle, so those fall back to the Mountain Time date they arrived.
--
-- The groupings:
--   new        whose first day ever is the day (in the daily series) or falls
--              in the window; their seven days count from that first day.
--   returning  everybody else; their seven days count from their first day in
--              the window.
--   standard / freeform
--              the mode a player was started in on first arrival: their
--              `mode_assigned` (from 2026-09-30), else the mode of their first
--              banked word, else the calendar's mode on their first day.
--
-- Puzzle type is the other way round: the players who banked a word in each
-- mode in the window, and of them, who turned up again within seven days of
-- their first such puzzle -- in either mode, because the question is whether
-- the mode brings people back, not whether it keeps them in it.
--
-- Chat splits every grouping into the players who opened the chat in the window
-- (`chat_opened`, from 2026-09-29) and those who did not. Opening it is an
-- action, so the chatters' acted is everybody by construction.
--
-- GitHub traffic (people building the game, clicking through from a pull
-- request) is left out of everything, as in every report before this one.
--
-- p_from, p_to: the window, both ends counted; null is the first or the latest
--   day anybody turned up.
-- p_today: the puzzle the viewer is on, which closes the seven-day returns;
--   null is the latest puzzle anybody banked a word on.
--
-- The daily series spans the window, except that a one-day window is shown in
-- the week around it: up to three days after, as far as today, and the rest
-- before.

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
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  -- The date is checked before it is cast: the endpoint that writes events is
  -- public, and one malformed row must not take the report down.
  events as (
    select
      e.name,
      e.props ->> 'player_id' as player_id,
      e.props ->> 'mode' as mode,
      e.props ->> 'reason' as reason,
      e.created_at,
      case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as day
    from public.analytics_events e
    where e.name in ('site_visit', 'visit_interacted', 'visit_engaged', 'leaderboard_opened',
                     'found_words_opened', 'chat_opened', 'mode_changed', 'puzzle_completed',
                     'result_copied', 'result_shared_on_x', 'mode_assigned')
      and e.props ->> 'player_id' is not null
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
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
      select 1 from github_players g where g.player_id = s.player_id::text)
  ),
  -- 1 turned up, 2 acted, 3 guessed: a player's day is the most they did on it.
  activity as (
    select player_id, day, 1 as level from events where name = 'site_visit'
    union all
    select player_id, day, 2 from events where name not in ('site_visit', 'mode_assigned')
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

  -- The mode each player was started in.
  assigned as (
    select distinct on (player_id) player_id, mode
    from events
    where name = 'mode_assigned'
      and mode in ('standard', 'freeform')
      and reason in ('shared', 'default', 'split')
    order by player_id, created_at
  ),
  first_play as (
    select distinct on (player_id) player_id, mode
    from plays
    order by player_id, day, mode desc
  ),
  players as (
    select
      d.player_id,
      min(d.day) as first_day
    from player_days d
    group by 1
  ),
  arrivals as (
    select
      p.player_id,
      p.first_day,
      coalesce(a.mode, f.mode,
        case when p.first_day >= date '2026-09-14' and p.first_day < date '2026-09-27'
          then 'freeform' else 'standard' end) as mode
    from players p
      left join assigned a on a.player_id = p.player_id
      left join first_play f on f.player_id = p.player_id
  ),
  chat_days as (
    select distinct player_id, day from events where name = 'chat_opened'
  ),

  -- Each player in the window, once.
  win_players as (
    select
      d.player_id,
      min(d.day) as anchor,
      max(d.level) as level,
      bool_or(c.player_id is not null) as chatted
    from player_days d
      cross join bounds b
      left join chat_days c on c.player_id = d.player_id and c.day = d.day
    where d.day between b.win_start and b.win_end
    group by 1
  ),
  win_rows as (
    select
      w.player_id,
      w.level,
      w.chatted,
      a.first_day >= b.win_start as is_new,
      a.mode,
      w.anchor + 7 < b.today as closed,
      exists (
        select 1 from player_days n
        where n.player_id = w.player_id and n.day > w.anchor and n.day <= w.anchor + 7
      ) as returned
    from win_players w
      join arrivals a on a.player_id = w.player_id
      cross join bounds b
  ),
  win_grouped as (
    select g.grp, r.*
    from win_rows r
      cross join lateral (values
        ('all'), (case when r.is_new then 'new' else 'returning' end), (r.mode)) as g(grp)
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
          'returned', jsonb_build_object(
            'cohort', count(r.player_id) filter (where r.closed),
            'returned', count(r.player_id) filter (where r.closed and r.returned),
            'soFar', count(r.player_id) filter (where r.returned))
        ) as v
      from (values ('all'), ('new'), ('returning'), ('standard'), ('freeform')) as k(grp)
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
          'returned', jsonb_build_object(
            'cohort', (select count(*) from win_grouped r
                       where r.grp = k.grp and r.chatted = s.chatted and r.closed),
            'returned', (select count(*) from win_grouped r
                         where r.grp = k.grp and r.chatted = s.chatted and r.closed and r.returned),
            'soFar', (select count(*) from win_grouped r
                      where r.grp = k.grp and r.chatted = s.chatted and r.returned))
        )) as v
      from (values ('all'), ('new'), ('returning'), ('standard'), ('freeform')) as k(grp)
        cross join (values ('opened', true), ('notOpened', false)) as s(side, chatted)
      group by k.grp
    ) x
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
      a.mode,
      exists (
        select 1 from player_days n
        where n.player_id = d.player_id and n.day > d.day and n.day <= d.day + 7
      ) as returned
    from player_days d
      join arrivals a on a.player_id = d.player_id
      cross join chart c
    where d.day between c.chart_start and c.chart_end
  ),
  day_grouped as (
    select g.grp, r.*
    from day_rows r
      cross join lateral (values
        ('all'), (case when r.is_new then 'new' else 'returning' end), (r.mode)) as g(grp)
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
        'returned', count(r.player_id) filter (where r.returned)
      ) as v
    from chart_days s
      cross join (values ('all'), ('new'), ('returning'), ('standard'), ('freeform')) as k(grp)
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
    'daily', (select v from daily)
  );
$$;

comment on function public.analytics_overview(date, date, date) is
  'Players, players who acted, guessed and returned within 7 days -- by new/returning, starting mode, puzzle type and chat -- for the /analytics page, as one JSON document. Read by api/review.ts.';

-- Explicit: service_role does not inherit what public is given, and a clean
-- stack grants it nothing by default.
revoke all on function public.analytics_overview(date, date, date) from public, anon, authenticated;
grant execute on function public.analytics_overview(date, date, date) to service_role;
