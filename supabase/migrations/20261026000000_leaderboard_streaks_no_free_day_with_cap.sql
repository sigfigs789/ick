-- No free day once a player has a freeze cap.
--
-- A missed day used to be covered for free after every played day, for every
-- player. Now that only holds until the player can hold a saved freeze -- a
-- best run of 7 days or more (`freezeCap` in src/game/streakFreeze.ts). Past
-- that, each missed day spends a saved freeze or ends the run, so the days a
-- run survives are the saved freezes alone, and a missed day covered at all is
-- covered by a freeze (`frozen`).
--
-- The game reports its saved freezes the same way (`streakReport`), counting
-- the free day only for a player without a cap. Same columns as
-- 20261025100000, so the function is replaced in place.
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
      (p_today - 1) - s.last_played as missed,
      g.grace,
      (p_today - 1) - s.last_played > g.grace + s.saved_freezes as lost
    from public.leaderboard_player_streaks s
    -- The free day, only for a player with no freeze cap yet (a best run under
    -- 7 days, `freezeCap` in src/game/streakFreeze.ts).
    cross join lateral (
      select case when s.best_streak >= 7 then 0 else 1 end as grace
    ) g
    -- The free day plus the saved freezes cover this many missed days; a run
    -- past that stays listed for its first two days lost, if it was a streak.
    where (p_today - 1) - s.last_played <= g.grace + s.saved_freezes
       or (
         (p_today - 1) - s.last_played <= g.grace + s.saved_freezes + 2
         and s.current_streak >= 2
       )
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
      not l.lost and l.missed > l.grace as frozen,
      not l.lost and l.missed >= 1 as covered,
      not l.lost and l.missed >= 1 and l.missed = l.grace + l.saved_freezes as at_risk
    from listed l
  )
  select r.rank, r.place, r.player_id, r.current_streak, r.best_streak,
    r.frozen, r.covered, r.at_risk, r.lost
  from ranked r
  where r.place <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.place;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
