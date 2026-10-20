-- A lost streak keeps its place on the board but not a rank.
--
-- 20261025000000 listed a run for its first two days over and ranked it with
-- everybody else, so a player still on a run sat a rank lower for somebody who
-- was out. Now only live runs are numbered: `rank` counts them alone, and a
-- lost run's `rank` is null. The lost row still sits where its length puts it,
-- and `place` is that position among every row listed -- the order the board
-- shows and the cut `p_limit` makes.
--
-- A lost run of one day is not listed: one puzzle is a start, not a streak
-- that was lost.
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
      (p_today - 1) - s.last_played > 1 + s.saved_freezes as lost
    from public.leaderboard_player_streaks s
    -- The free day plus the saved freezes cover this many missed days; a run
    -- past that stays listed for its first two days lost, if it was a streak.
    where (p_today - 1) - s.last_played <= 1 + s.saved_freezes
       or (
         (p_today - 1) - s.last_played <= 1 + s.saved_freezes + 2
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
      not l.lost and l.missed >= 2 as frozen,
      not l.lost and l.missed >= 1 as covered,
      not l.lost and l.missed >= 1 and l.missed = 1 + l.saved_freezes as at_risk
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
