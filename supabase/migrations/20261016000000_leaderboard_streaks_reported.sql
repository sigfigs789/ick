-- The streak board shows the game's own streak, as each player's game reports it.
--
-- The board used to rebuild every run from the days in leaderboard_scores, by
-- a copy of the game's freeze rule (20261015200000 to 20261015220000). Saved
-- freezes made that copy a replay of each player's whole history -- which days
-- earned one, which gaps spent one -- and two copies of a rule drift. So the
-- game now sends its streak with every write (see `streakReport` in
-- src/game/streakFreeze.ts), and the board ranks by that.
--
-- What is sent is the streak as of its last played day: the run's length, the
-- longest run, and the freezes saved at that point. That is enough to say on
-- any later day whether the run is still alive -- the days missed since are no
-- more than the one free day plus the saved freezes -- and whether a saved
-- freeze is what is holding it (two or more missed), which the game and the
-- board both show as 🧊. The free missed day keeps the 🔥.

create table if not exists public.leaderboard_player_streaks (
  player_id uuid primary key,
  current_streak integer not null check (current_streak >= 1),
  best_streak integer not null check (best_streak >= current_streak),
  saved_freezes integer not null default 0 check (saved_freezes between 0 and 2),
  last_played date not null,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard_player_streaks enable row level security;
revoke all on public.leaderboard_player_streaks from public, anon, authenticated;
-- Granted to service_role explicitly: it inherits nothing (see 20260825000000).
grant select, insert, update on public.leaderboard_player_streaks to service_role;

/*
 * Record a player's streak as their game reports it.
 *
 * Never moves backwards in time: a report about an earlier last-played day
 * than the one on file -- a second browser that has not played since, or a
 * request that arrived late -- is ignored. A report about the same day replaces
 * what is there, which is how a freeze earned on that day's play lands.
 */
create or replace function public.submit_leaderboard_streak(
  p_player_id uuid,
  p_current integer,
  p_best integer,
  p_saved integer,
  p_last_played date
) returns void
language sql
as $$
  insert into public.leaderboard_player_streaks as s
    (player_id, current_streak, best_streak, saved_freezes, last_played)
  values (p_player_id, p_current, greatest(p_best, p_current), p_saved, p_last_played)
  on conflict (player_id) do update set
    current_streak = excluded.current_streak,
    best_streak = greatest(s.best_streak, excluded.best_streak),
    saved_freezes = excluded.saved_freezes,
    last_played = excluded.last_played,
    updated_at = now()
  where excluded.last_played >= s.last_played;
$$;

revoke all on function public.submit_leaderboard_streak(uuid, integer, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_streak(uuid, integer, integer, integer, date)
  to service_role;

-- The output columns change (`at_risk` and `streak_since` go, `frozen` comes),
-- which `create or replace` cannot do, so the function is dropped and recreated
-- in this one transaction. The endpoint treats a failed streak read as an empty
-- board (api/leaderboard.ts), so a request landing mid-swap costs that board
-- for one load and nothing else.
drop function if exists public.leaderboard_streaks(date, integer, uuid);

create function public.leaderboard_streaks(
  p_today date,
  p_limit integer default 15,
  p_player uuid default null
) returns table (
  rank integer,
  player_id uuid,
  current_streak integer,
  best_streak integer,
  frozen boolean
)
language sql
stable
as $$
  with alive as (
    select
      s.player_id,
      s.current_streak,
      s.best_streak,
      -- Days missed through yesterday. Negative for a player whose calendar is
      -- ahead of the reader's and has played their today already.
      (p_today - 1) - s.last_played as missed
    from public.leaderboard_player_streaks s
    -- The free day plus the saved freezes cover this many missed days.
    where (p_today - 1) - s.last_played <= 1 + s.saved_freezes
  ),
  ranked as (
    select
      row_number() over (
        order by a.current_streak desc, a.best_streak desc, a.player_id
      )::integer as rank,
      a.player_id,
      a.current_streak,
      a.best_streak,
      a.missed >= 2 as frozen
    from alive a
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.frozen
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
