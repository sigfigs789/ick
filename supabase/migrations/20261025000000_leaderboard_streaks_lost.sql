-- A streak that ends stays on the streak board for two days, marked 💀.
--
-- The board used to drop a run the day the free day and every saved freeze ran
-- out. Now a run that has just ended keeps its row -- at the length it reached,
-- ranked where that length puts it -- for the first two days it is over, and
-- `lost` says so. On the third day it leaves the board.
--
-- A run ends the day the days missed exceed the free day plus the freezes
-- saved on the last day played (the test `alive` filters by below). The day
-- after it was at risk is its first day lost; the day after that, its second.
--
-- Coming back needs nothing here: the game's next report is about a later day
-- played, so `submit_leaderboard_streak` replaces the lost run with the new
-- one, and the row shows the new streak and no 💀.
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
  at_risk boolean,
  lost boolean
)
language sql
stable
as $$
  with listed as (
    select
      s.player_id,
      s.current_streak,
      s.best_streak,
      s.saved_freezes,
      -- Days missed through yesterday. Negative for a player whose calendar is
      -- ahead of the reader's and has played their today already.
      (p_today - 1) - s.last_played as missed
    from public.leaderboard_player_streaks s
    -- The free day plus the saved freezes cover this many missed days; a run
    -- past that stays listed for its first two days lost.
    where (p_today - 1) - s.last_played <= 1 + s.saved_freezes + 2
  ),
  ranked as (
    select
      row_number() over (
        order by l.current_streak desc, l.best_streak desc, l.player_id
      )::integer as rank,
      l.player_id,
      l.current_streak,
      l.best_streak,
      l.missed > 1 + l.saved_freezes as lost,
      l.missed >= 2 and l.missed <= 1 + l.saved_freezes as frozen,
      l.missed >= 1 and l.missed <= 1 + l.saved_freezes as covered,
      l.missed >= 1 and l.missed = 1 + l.saved_freezes as at_risk
    from listed l
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.frozen, r.covered, r.at_risk, r.lost
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
