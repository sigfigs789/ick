-- /analytics is cut down to three questions, and the report with it:
--
--   1. Day by day: who turned up, split new and returning; how many of each
--      played; and the share of each day's new players who came back to play
--      within the week after.
--   2. Standard against Freeform, new and returning: players, the share who
--      played, and the share who came back to play within a week.
--   3. The same, by the source the player first arrived through.
--
-- Everything else the page drew is gone, and so are the functions that only fed
-- it. analytics_report drops its date argument (the page has only preset
-- windows now) and is rebuilt from scratch; it no longer shares a body with
-- 20261014020000_analytics_retention_first_month.sql.
--
-- The words, defined once here:
--
--   appeared  a player on a puzzle: opened the game on the web for it
--             (`site_visit`, by the puzzle it is stamped with, or by its
--             Mountain Time receipt day before visits carried one), or banked a
--             word on it on any platform. The iOS app and the Reddit post report
--             no opens, so their players appear only once they play.
--   played    banked a word on that puzzle, in either mode.
--   new       the puzzle is the first the player ever appeared on; anybody
--             else who appeared is returning.
--   back      played on any of the seven puzzles after it. Counted only once all
--             seven are over -- before the latest puzzle, which is still live --
--             so a recent day reads as not-yet rather than as nobody.
--
-- Rates are over player-days: for a new player that is their one first day, for
-- a returning player every day they appeared. A player-day's mode is the one
-- they played in (both, when they played both, so it counts in each row); on a
-- day they did not play, the mode they were last in -- their last play before
-- it, or else the mode the game started them in (`mode_assigned`). A day with
-- neither is in no mode row. Their source is the first-touch source of their
-- earliest event; a player with no web events at all is `untracked`.
--
-- GitHub traffic stays out of every number, as before: that is the people
-- building the game clicking through from a pull request.

drop function if exists public.analytics_report(integer, date);
drop function if exists public.chat_report(integer, date);
drop function if exists public.onboarding_report(integer);
drop function if exists public.copy_report(integer, date);
drop function if exists public.retention_report(integer, date);
drop function if exists public.perfect_report(integer, date);
drop function if exists public.estimated_score_report(integer, date);

create or replace function public.analytics_report(p_days integer default 60)
returns jsonb
language sql
stable
as $$
  with
  days as (select greatest(7, least(coalesce(p_days, 60), 365)) as n),
  github_players as (
    select distinct e.props ->> 'player_id' as player_id
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and (e.props ->> 'source' ~ '(^|\.)github(\.com|\.io)?$'
        or e.props ->> 'last_source' ~ '(^|\.)github(\.com|\.io)?$')
  ),
  plays as (
    select distinct
      s.player_id::text as player_id,
      s.puzzle_date,
      case
        when s.mode in ('standard', 'freeform') then s.mode
        when s.puzzle_date >= date '2026-09-14' and s.puzzle_date < date '2026-09-27' then 'freeform'
        else 'standard'
      end as mode
    from public.leaderboard_scores s
    where not exists (
      select 1 from github_players g where g.player_id = s.player_id::text)
  ),
  player_days as (
    select distinct player_id, puzzle_date from plays
  ),
  -- The endpoint is public, so a date is checked before it is cast: one
  -- malformed row must not be able to take the whole report down.
  opens as (
    select distinct
      e.props ->> 'player_id' as player_id,
      case
        when e.props ->> 'puzzle_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(e.props ->> 'puzzle_date', 'date')
        then (e.props ->> 'puzzle_date')::date
        else (e.created_at at time zone 'America/Denver')::date
      end as puzzle_date
    from public.analytics_events e
    where e.name = 'site_visit'
      and e.props ->> 'player_id' is not null
      and not exists (
        select 1 from github_players g where g.player_id = e.props ->> 'player_id')
  ),
  appearances as (
    select player_id, puzzle_date from opens
    union
    select player_id, puzzle_date from player_days
  ),
  firsts as (
    select player_id, min(puzzle_date) as first_day from appearances group by 1
  ),
  -- The latest puzzle anybody played: "today", wherever the players are.
  bounds as (select max(puzzle_date) as as_of from plays),
  win as (
    select b.as_of - (d.n - 1) as win_start, b.as_of as win_end
    from bounds b, days d
  ),
  assigned as (
    select distinct on (e.props ->> 'player_id')
      e.props ->> 'player_id' as player_id,
      e.props ->> 'mode' as mode
    from public.analytics_events e
    where e.name = 'mode_assigned'
      and e.props ->> 'player_id' is not null
      and e.props ->> 'mode' in ('standard', 'freeform')
    order by e.props ->> 'player_id', e.created_at
  ),
  sources as (
    select distinct on (e.props ->> 'player_id')
      e.props ->> 'player_id' as player_id,
      coalesce(e.props ->> 'source', 'direct') as source
    from public.analytics_events e
    where e.props ->> 'player_id' is not null
      and e.name in ('site_visit', 'mode_assigned')
    order by e.props ->> 'player_id', e.created_at
  ),
  -- Every player-day in the window, and what came of it.
  window_days as (
    select
      a.player_id,
      a.puzzle_date,
      a.puzzle_date = f.first_day as is_new,
      exists (select 1 from player_days d
              where d.player_id = a.player_id and d.puzzle_date = a.puzzle_date) as played,
      a.puzzle_date + 7 < b.as_of as week_over,
      exists (select 1 from player_days d
              where d.player_id = a.player_id
                and d.puzzle_date > a.puzzle_date and d.puzzle_date <= a.puzzle_date + 7) as back
    from appearances a
      join firsts f on f.player_id = a.player_id,
      win w, bounds b
    where a.puzzle_date between w.win_start and w.win_end
  ),
  moded as (
    select w.*, m.mode
    from window_days w
      cross join lateral (
        select p.mode from plays p
        where p.player_id = w.player_id and p.puzzle_date = w.puzzle_date
        union all
        select coalesce(
          (select p.mode from plays p
           where p.player_id = w.player_id and p.puzzle_date < w.puzzle_date
           order by p.puzzle_date desc limit 1),
          (select a.mode from assigned a where a.player_id = w.player_id))
        where not w.played
      ) m
    where m.mode is not null
  ),
  sourced as (
    select w.*, coalesce(s.source, 'untracked') as source
    from window_days w
      left join sources s on s.player_id = w.player_id
  ),

  -- Every puzzle in the window, a quiet one included as zeros.
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', x.day,
      'newAppeared', x.new_appeared,
      'newPlayed', x.new_played,
      'returningAppeared', x.returning_appeared,
      'returningPlayed', x.returning_played,
      'newBack', jsonb_build_object('cohort', x.cohort, 'returned', x.returned)
    ) order by x.day), '[]'::jsonb) as v
    from (
      select
        g.day,
        count(w.player_id) filter (where w.is_new) as new_appeared,
        count(w.player_id) filter (where w.is_new and w.played) as new_played,
        count(w.player_id) filter (where not w.is_new) as returning_appeared,
        count(w.player_id) filter (where not w.is_new and w.played) as returning_played,
        count(w.player_id) filter (where w.is_new and w.week_over) as cohort,
        count(w.player_id) filter (where w.is_new and w.week_over and w.back) as returned
      from (
        select gs::date as day
        from win, generate_series(win.win_start, win.win_end, interval '1 day') gs
        where win.win_end is not null
      ) g
        left join window_days w on w.puzzle_date = g.day
      group by g.day
    ) x
  ),
  modes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', x.mode, 'isNew', x.is_new, 'players', x.players, 'days', x.days,
      'played', x.played, 'back', jsonb_build_object('cohort', x.cohort, 'returned', x.returned)
    ) order by x.mode desc, x.is_new desc), '[]'::jsonb) as v
    from (
      select mode, is_new,
        count(distinct player_id) as players,
        count(*) as days,
        count(*) filter (where played) as played,
        count(*) filter (where week_over) as cohort,
        count(*) filter (where week_over and back) as returned
      from moded group by mode, is_new
    ) x
  ),
  source_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', x.source, 'isNew', x.is_new, 'players', x.players, 'days', x.days,
      'played', x.played, 'back', jsonb_build_object('cohort', x.cohort, 'returned', x.returned)
    ) order by x.total desc, x.source, x.is_new desc), '[]'::jsonb) as v
    from (
      select source, is_new,
        count(distinct player_id) as players,
        count(*) as days,
        count(*) filter (where played) as played,
        count(*) filter (where week_over) as cohort,
        count(*) filter (where week_over and back) as returned,
        sum(count(distinct player_id)) over (partition by source) as total
      from sourced group by source, is_new
    ) x
  )

  select jsonb_build_object(
    'asOf', (select as_of from bounds),
    'windowDays', (select n from days),
    'daily', (select v from daily),
    'modes', (select v from modes),
    'sources', (select v from source_rows)
  );
$$;

comment on function public.analytics_report(integer) is
  'Daily new and returning players, who of them played, and who came back to play within a week, overall and by mode and source, for the /analytics page. Read by api/review.ts.';

-- Explicit: service_role does not inherit what public is given, and a clean
-- stack grants it nothing by default.
revoke all on function public.analytics_report(integer) from public, anon, authenticated;
grant execute on function public.analytics_report(integer) to service_role;
