-- An earned rest day is now the whole weekend. The week runs Monday to
-- Sunday: three days played from the Monday, each on its own day, rest each
-- weekend day after them -- so three by Friday rest the Saturday and the
-- Sunday, and a Saturday played as the third rests the Sunday
-- (see `isRestDay` in src/game/streakFreeze.ts).
--
-- The game still sends one date, the Saturday (`restDay` in `streakReport`),
-- and the board rests it and the day after, less any played: a Saturday
-- played is `last_played` itself, so only its Sunday is taken off the gap.
-- A Sunday played ends its week, so it never sends one.
--
-- An unearned weekend is two missed days like any other.

-- Same columns as 20261104000000, so the function is replaced in place.
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
      -- Days missed through yesterday, less the earned weekend's Saturday
      -- and Sunday that are among them. Negative for a player whose calendar
      -- is ahead of the reader's and has played their today already.
      (p_today - 1) - s.last_played - (
        case when s.rest_day > s.last_played and s.rest_day <= p_today - 1 then 1 else 0 end
      ) - (
        case when s.rest_day + 1 > s.last_played and s.rest_day + 1 <= p_today - 1 then 1 else 0 end
      ) as missed,
      -- Coalesced: a run with no earned weekend has a null rest_day, and a
      -- null here would leave at_risk null too.
      coalesce(p_today in (s.rest_day, s.rest_day + 1), false) and s.last_played < p_today as resting
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
