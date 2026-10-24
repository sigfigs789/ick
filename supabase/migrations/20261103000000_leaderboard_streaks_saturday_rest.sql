-- Saturdays are rest days.
--
-- From Saturday 2026-10-24 an unplayed Saturday is not a missed day: it spends
-- no saved freeze and ends no run (`isRestDay` in src/game/streakFreeze.ts).
-- So the days missed since a run's last played day leave out the Saturdays in
-- between, and nothing else about how a run survives changes.
--
-- On a Saturday itself, a live run not played yet is `resting`: the board
-- shows it 🕺, 💃 or 😴 instead of 🔥, 🧊 or ⏳, and it is never `at_risk`, as
-- missing today cannot end it. Playing turns it back to 🔥.
--
-- Saturdays in (last_played, p_today - 1] are counted in closed form against
-- 2026-10-24, the first rest day: whole weeks from it to each end, with the
-- start of the range held at the day before it so earlier Saturdays never
-- count.
--
-- The output columns change, which `create or replace` cannot do, so the
-- function is dropped and recreated in this one transaction, as in
-- 20261025100000.
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
      -- Days missed through yesterday, rest days left out. Negative for a
      -- player whose calendar is ahead of the reader's and has played their
      -- today already.
      (p_today - 1) - s.last_played - greatest(
        0,
        floor(((p_today - 1) - date '2026-10-24') / 7.0)
          - floor((greatest(s.last_played, date '2026-10-23') - date '2026-10-24') / 7.0)
      )::integer as missed
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
      g.missed > g.saved_freezes as lost
    from gaps g
    -- The saved freezes cover this many missed days; a run past that stays
    -- listed for its first two days lost, if it was a streak.
    where g.missed <= g.saved_freezes
       or (g.missed <= g.saved_freezes + 2 and g.current_streak >= 2)
  ),
  today as (
    select p_today >= date '2026-10-24' and extract(isodow from p_today) = 6 as rest_day
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
      not l.lost and not t.rest_day and l.missed >= 1 and l.missed = l.saved_freezes as at_risk,
      not l.lost and t.rest_day and l.last_played < p_today as resting
    from listed l
    cross join today t
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
