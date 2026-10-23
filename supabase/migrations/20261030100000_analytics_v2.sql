-- /analyticsV2's one report: a daily dashboard built straight from the raw
-- tables (analytics_events, leaderboard_scores), with its own definitions.
--
-- Who is counted
--   Every player_id in the events or on the board, except:
--     * Muse, the maintainer's AI player (visitor = 'mos-muse' on any event);
--     * bots: any browser whose site_visit says it was automated (webdriver,
--       bot_ua or server_bot_ua);
--     * anyone who arrived from a Vercel page (source or last_source on
--       vercel.com or vercel.app) -- deploy and preview clicks, not players;
--     * the maintainer's own account, NorthernBear87 (named below, and on the
--       hand-kept analytics_excluded_players list with anyone else there).
--
-- Visitors and players are two populations, and kept apart:
--   visitor   Turned up on a day: any event, or a board row.
--   player    Banked a word on a day: a leaderboard_scores row, or an
--             answer_accepted event. "Active" means a player.
-- Activation is the bridge -- the share of first-time visitors who bank a
-- word -- and everything about coming back, how often, and sharing is counted
-- over players: a player's first day is the first day they banked a word, and
-- back means they banked one again. Visitor return rates are given beside them.
--
-- Other words
--   day       The puzzle a row belongs to: puzzle_date when the event carries a
--             valid one, else the date it arrived in Mountain Time.
--   started   Tried a word that day (accepted or rejected), or banked one.
--   completed Sent puzzle_completed that day.
--   shared    Copied or posted their result that day.
--   week      Sunday to Saturday.
--
-- Events carry a player_id only from late September 2026; before that the
-- board is the only record of who played. `trackedSince` is the first day a
-- visit was recorded against a player, and a visitor number over a window
-- that starts before it is not a number (the page says so). Players, from the
-- board, go back to the first puzzle.
--
-- Every window ends at p_today, the puzzle the reader is on, and leaves it out
-- as still filling up. Rates that need a later day to be over count only the
-- days whose later day is before p_today.
--
-- Written set by set -- one pass over the events, then joins and group-bys on
-- (player, day) -- because a lookup per row against the events table is what
-- makes a report like this take a minute.

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

  -- Weeks, Sunday to Saturday: the current one (still counting) and the eleven
  -- before it.
  weeks as (
    select p_today - extract(dow from p_today)::int - 7 * k as start
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
      select player_id, first_active - extract(dow from first_active)::int as start
      from visitors where first_active is not null
    ) c
      join (
        select player_id, day - extract(dow from day)::int as week
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
