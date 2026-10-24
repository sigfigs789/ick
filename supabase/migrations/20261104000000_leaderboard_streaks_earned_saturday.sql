-- A Saturday off is earned, not free: three days played that week, Sunday to
-- Friday, each on its own day (see `isRestDay` in src/game/streakFreeze.ts).
--
-- 20261103100000 skipped every Saturday from 2026-10-31. Now only an earned
-- one is skipped, and it is good for that Saturday only -- never saved. The
-- game says which Saturday it earned with each streak report (`restDay` in
-- `streakReport`): only the Saturday ending the last played day's week can
-- have been earned, since no later week has been played. So one date per
-- player is all the board needs, and the rule stays in the game.
--
-- An unearned Saturday is a missed day like any other: it spends a saved
-- freeze or ends the run, and can be the day a run is at risk.

alter table public.leaderboard_player_streaks
  add column if not exists rest_day date;

-- A defaulted parameter rather than a second overload, so an endpoint still
-- calling with five arguments keeps working until it deploys.
drop function if exists public.submit_leaderboard_streak(uuid, integer, integer, integer, date);

create function public.submit_leaderboard_streak(
  p_player_id uuid,
  p_current integer,
  p_best integer,
  p_saved integer,
  p_last_played date,
  p_rest_day date default null
) returns void
language sql
as $$
  insert into public.leaderboard_player_streaks as s
    (player_id, current_streak, best_streak, saved_freezes, last_played, rest_day)
  values (p_player_id, p_current, greatest(p_best, p_current), p_saved, p_last_played, p_rest_day)
  on conflict (player_id) do update set
    current_streak = excluded.current_streak,
    best_streak = greatest(s.best_streak, excluded.best_streak),
    saved_freezes = excluded.saved_freezes,
    last_played = excluded.last_played,
    rest_day = excluded.rest_day,
    updated_at = now()
  where excluded.last_played >= s.last_played;
$$;

revoke all on function public.submit_leaderboard_streak(uuid, integer, integer, integer, date, date)
  from public, anon, authenticated;
-- Granted to service_role explicitly: it inherits nothing (see 20260825000000).
grant execute on function public.submit_leaderboard_streak(uuid, integer, integer, integer, date, date)
  to service_role;

-- Same columns as 20261103100000, so the function is replaced in place.
create or replace function public.leaderboard_streaks(
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
  resting boolean
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
      s.rest_day = p_today and s.last_played < p_today as resting
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
      g.missed > g.saved_freezes as lost,
      g.resting
    from gaps g
    -- The saved freezes cover this many missed days; a run past that stays
    -- listed for its first two days lost, if it was a streak.
    where g.missed <= g.saved_freezes
       or (g.missed <= g.saved_freezes + 2 and g.current_streak >= 2)
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
      not l.lost and l.missed >= 1 as frozen,
      not l.lost and l.missed >= 1 as covered,
      not l.lost and not l.resting and l.missed >= 1 and l.missed = l.saved_freezes as at_risk,
      not l.lost and l.resting as resting
    from listed l
  )
  select r.rank, r.place, r.player_id, r.current_streak, r.best_streak,
    r.frozen, r.covered, r.at_risk, r.lost, r.resting
  from ranked r
  where r.place <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.place;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
