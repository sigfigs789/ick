-- A run the saved freezes cannot cover is not over yet: the last missed day
-- (yesterday) can still be made up by playing its puzzle late (see
-- `catchUpDays` in src/game/streakFreeze.ts). So the streak board stops
-- killing a run the day its freezes run out.
--
-- For the one day missed past the saved freezes the run is `endangered`:
-- still listed and still ranked, at the length it reached, and shown ⚠️ where
-- the day before it was ⏳. Only after that is it `lost` (💀), listed for two
-- more days, and then it leaves the board.
--
-- A day made up reaches the board through `saved_freezes`: the game counts
-- every day made up since the last day played as one more saved (see
-- `streakReport`), and re-sends its report with the archive puzzle's words.
--
-- The dead-streaks board needs no change: it already waits one day past the
-- saved freezes (20261017000000), the day that can now be made up.
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
  place integer,
  player_id uuid,
  current_streak integer,
  best_streak integer,
  frozen boolean,
  covered boolean,
  at_risk boolean,
  lost boolean,
  resting boolean,
  endangered boolean
)
language sql
stable
as $$
  with gaps as (
    select
      s.player_id,
      s.current_streak,
      s.best_streak,
      s.saved_freezes,
      s.last_played,
      -- Days missed through yesterday, less the earned Saturday if it is
      -- among them. Negative for a player whose calendar is ahead of the
      -- reader's and has played their today already.
      (p_today - 1) - s.last_played - (
        case when s.rest_day > s.last_played and s.rest_day <= p_today - 1 then 1 else 0 end
      ) as missed,
      -- Coalesced: a run with no earned Saturday has a null rest_day, and a
      -- null here would leave at_risk null too.
      coalesce(s.rest_day = p_today, false) and s.last_played < p_today as resting
    from public.leaderboard_player_streaks s
  ),
  listed as (
    select
      g.player_id,
      g.current_streak,
      g.best_streak,
      g.saved_freezes,
      g.last_played,
      g.missed,
      -- One missed day past the freezes can still be made up.
      g.missed > g.saved_freezes + 1 as lost,
      g.missed = g.saved_freezes + 1 as endangered,
      g.resting
    from gaps g
    -- Alive or endangered; a run past that stays listed for its first two
    -- days lost, if it was a streak.
    where g.missed <= g.saved_freezes + 1
       or (g.missed <= g.saved_freezes + 3 and g.current_streak >= 2)
  ),
  ranked as (
    select
      case when l.lost then null else
        row_number() over (
          partition by l.lost
          order by l.current_streak desc, l.best_streak desc, l.player_id
        )::integer
      end as rank,
      row_number() over (
        order by l.current_streak desc, l.best_streak desc, l.lost, l.player_id
      )::integer as place,
      l.player_id,
      l.current_streak,
      l.best_streak,
      l.lost,
      l.endangered,
      not l.lost and not l.endangered and l.missed >= 1 as frozen,
      not l.lost and not l.endangered and l.missed >= 1 as covered,
      not l.lost and not l.endangered and not l.resting and l.missed >= 1
        and l.missed = l.saved_freezes as at_risk,
      not l.lost and not l.endangered and l.resting as resting
    from listed l
  )
  select r.rank, r.place, r.player_id, r.current_streak, r.best_streak,
    r.frozen, r.covered, r.at_risk, r.lost, r.resting, r.endangered
  from ranked r
  where r.place <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.place;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
