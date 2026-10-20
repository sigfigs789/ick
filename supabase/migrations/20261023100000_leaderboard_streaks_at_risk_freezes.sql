-- The streak board marks a run at risk only when it is: missing today ends it.
--
-- 20261021200000 drew ⏳ on every run with a missed day covered, even when a
-- saved freeze was left to cover today as well. The game says "Play today to
-- keep your streak" only once the free day and every saved freeze are spent
-- (`atRisk` in src/game/streakFreeze.ts), so a player holding a freeze saw the
-- board call their run at risk while their own game said nothing.
--
-- `at_risk` is that same test: at least one day missed, today not played, and
-- the missed days already equal to the free day plus the freezes saved on the
-- last day played -- nothing left for today. `frozen` and `covered` are
-- unchanged, so the board can still say what is holding the run up.
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
  covered boolean,
  at_risk boolean
)
language sql
stable
as $$
  with alive as (
    select
      s.player_id,
      s.current_streak,
      s.best_streak,
      s.saved_freezes,
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
      a.missed >= 1 as covered,
      a.missed >= 1 and a.missed >= 1 + a.saved_freezes as at_risk
    from alive a
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.frozen, r.covered, r.at_risk
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
