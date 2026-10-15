-- Streaks forgive a missed day only from when the game did.
--
-- Streak freezes shipped on 2026-10-05 (#389, live 16:35 UTC). Before that a
-- single missed day reset the game's own streak, but 20261015200000 applied the
-- freeze rule to all history -- so a player who missed one day in September and
-- has played every day since showed their two runs joined into one, far longer
-- than the 🔥 their game shows them.
--
-- Now a one-day gap is frozen over only when the day that closed it was first
-- played after the freeze went live -- the row's `created_at`, which is when the
-- day's first word reached the board. A player who missed the 4th and played
-- the morning of the 5th was reset by the game they had, and still is here; one
-- who played that afternoon was covered. Any earlier gap ends the run, as it did
-- in the game at the time, so `best_streak` also agrees with the game's own
-- longest streak.
--
-- Approximate at the edges, and knowingly: a day backfilled when a player first
-- joined carries the time they joined, not the time they played, and a stale
-- client could still have been running the old rule after the deploy.
--
-- Same signature and return type; the grants are restated anyway.

create or replace function public.leaderboard_streaks(
  p_today date,
  p_limit integer default 15,
  p_player uuid default null
) returns table (
  rank integer,
  player_id uuid,
  current_streak integer,
  best_streak integer,
  streak_since date
)
language sql
stable
as $$
  with active as (
    -- Only a player who has played in the last three days can be on a run, so
    -- the history scan below is bounded to them rather than to everybody ever.
    select distinct s.player_id
    from public.leaderboard_scores s
    where s.puzzle_date between p_today - 2 and p_today
  ),
  days as (
    -- One row per day played, either mode, keeping the earliest arrival.
    select s.player_id, s.puzzle_date, min(s.created_at) as first_played_at
    from public.leaderboard_scores s
    join active a on a.player_id = s.player_id
    where s.puzzle_date <= p_today
    group by s.player_id, s.puzzle_date
  ),
  breaks as (
    select
      d.player_id,
      d.puzzle_date,
      -- A gap of one missed day (two calendar days) is frozen over, but only
      -- once the game could freeze one; before that any missed day started a
      -- new run, and anything wider always does.
      case
        when d.puzzle_date - lag(d.puzzle_date) over (
          partition by d.player_id order by d.puzzle_date
        ) <= case
          when d.first_played_at >= timestamptz '2026-10-05 16:35:31+00' then 2
          else 1
        end then 0
        else 1
      end as starts_run
    from days d
  ),
  runs as (
    select
      b.player_id,
      b.puzzle_date,
      sum(b.starts_run) over (
        partition by b.player_id order by b.puzzle_date
      ) as run
    from breaks b
  ),
  streaks as (
    select
      r.player_id,
      count(*)::integer as length,
      min(r.puzzle_date) as started,
      max(r.puzzle_date) as last_played
    from runs r
    group by r.player_id, r.run
  ),
  per_player as (
    select
      st.player_id,
      max(st.length) filter (where st.last_played >= p_today - 2) as current_streak,
      max(st.length) as best_streak,
      max(st.started) filter (where st.last_played >= p_today - 2) as streak_since
    from streaks st
    group by st.player_id
  ),
  ranked as (
    select
      row_number() over (
        order by p.current_streak desc, p.best_streak desc, p.streak_since asc, p.player_id
      )::integer as rank,
      p.player_id,
      p.current_streak,
      p.best_streak,
      p.streak_since
    from per_player p
    where p.current_streak is not null
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.streak_since
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
