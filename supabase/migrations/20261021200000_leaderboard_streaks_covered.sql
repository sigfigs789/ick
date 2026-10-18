-- The streak board marks the runs a freeze is holding up today.
--
-- A run is alive while the days missed through yesterday are no more than the
-- one free day plus the freezes saved on its last day played (20261016000000).
-- `covered` is a live run with at least one of those days missed and today not
-- played yet: the free day or a saved freeze is what is keeping it going, so it
-- is at risk, even when a saved freeze or two would still carry it further.
--
-- It is wider than `frozen`, which is only a saved freeze covering (two or more
-- missed) and is what the game shows as 🧊. The free missed day keeps the 🔥
-- in the game and on the board, so the board marks it with `covered` instead.
--
-- The output columns change, which `create or replace` cannot do, so the
-- function is dropped and recreated in this one transaction. The endpoint
-- treats a failed streak read as an empty board (api/leaderboard.ts), so a
-- request landing mid-swap costs that board for one load and nothing else.
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
  frozen boolean,
  covered boolean
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
      a.missed >= 2 as frozen,
      a.missed >= 1 as covered
    from alive a
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.frozen, r.covered
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
