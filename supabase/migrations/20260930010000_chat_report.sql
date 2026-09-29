-- chat_report: the chat room's numbers for the /analytics page.
--
-- Its own function rather than another copy of analytics_report, which is five
-- hundred lines rebuilt whole by every change to it. api/review.ts reads both
-- and sets this one's document on the report as `chat`, so the page is still
-- one request.
--
-- Two sources, like analytics_report, each for what it can answer:
--
--   analytics_events  the four chat events the bubble sends (src/analytics.ts):
--                     `chat_opened`, `chat_time`, `chat_message_sent`,
--                     `chat_message_blocked`. Every one carries `puzzle_date`
--                     and `player_id`, so views, time and senders are counted
--                     per puzzle and per person. Fire-and-forget, so a few may
--                     be missing; nothing here assumes they are complete.
--   chat_messages     the room itself, which is authoritative about what was
--                     posted. Read for the all-time room totals only: it has
--                     no puzzle date, and a message's clock time is not the
--                     puzzle its sender was on.
--
-- The window is the last `p_days` puzzles up to the latest one anybody played,
-- the same `asOf` analytics_report uses, so "today" means the same thing in both
-- halves of the page. GitHub traffic is left out exactly as it is there.
--
-- Nothing identifying leaves the function: counts, shares and durations.

create or replace function public.chat_report(p_days integer default 60)
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

comment on function public.chat_report(integer) is
  'Chat views, time, senders, messages and blocks for the /analytics page, as one JSON document. Read by api/review.ts alongside analytics_report.';

revoke all on function public.chat_report(integer) from public, anon, authenticated;
grant execute on function public.chat_report(integer) to service_role;
