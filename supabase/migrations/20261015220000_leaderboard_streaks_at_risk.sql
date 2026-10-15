-- The streak board says which runs are at risk.
--
-- A player who missed yesterday is still on the board -- the freeze covers one
-- missed day -- but loses the run if today goes unplayed too. The game marks
-- that day with 🧊 instead of 🔥, and now the board can as well: `at_risk` is
-- true when the player's last day played is the day before yesterday.
--
-- Everything else is 20261015210000 unchanged. A new output column changes the
-- return type, which `create or replace` cannot do, so the function is dropped
-- and recreated in this one transaction. The endpoint reads the streak board
-- separately and treats a failed read as an empty board (api/leaderboard.ts),
-- so a request landing mid-swap costs that board for one load and nothing else.

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
  streak_since date,
  at_risk boolean
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
      max(st.started) filter (where st.last_played >= p_today - 2) as streak_since,
      -- Yesterday was missed and today is not played yet: the one day a run
      -- can be lost, which the game shows as 🧊 (see `atRisk` in
      -- src/game/streakFreeze.ts).
      max(st.last_played) = p_today - 2 as at_risk
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
      p.streak_since,
      p.at_risk
    from per_player p
    where p.current_streak is not null
  )
  select r.rank, r.player_id, r.current_streak, r.best_streak, r.streak_since, r.at_risk
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_streaks(date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.leaderboard_streaks(date, integer, uuid)
  to service_role;
