-- The streak board: players ranked by the streak they are on right now.
--
-- STREAK RULE, the game's own (src/game/streakFreeze.ts): a streak counts days
-- played, and a single missed day between two played ones is covered by a
-- freeze -- it keeps the streak alive without adding to it. Two missed days in a
-- row end it. So a run here is a player's board days where no two consecutive
-- ones are more than two days apart, and its length is how many days it holds.
--
-- A streak is *current* when its last day is the reader's today, yesterday, or
-- the day before (yesterday frozen, today not yet played -- the 🧊 day the game
-- calls at risk). Only current streaks are ranked: the board is who is on a run
-- now, and a run that has ended drops off it. The best run a player has ever
-- had rides along as the row's detail, and breaks ties.
--
-- Built from `leaderboard_scores`, so the days counted are the board's days:
-- played on their own date (archive play is never written here), from a client
-- at or above the ranked version floor. Either mode counts, and a day played in
-- both counts once -- the game's own streak does not care which rules a day was
-- played under, so neither does this. `p_mode` is not taken for that reason.
--
-- `p_today` is the reader's own local puzzle date, like every other window the
-- boards count (see src/game/week.ts): what counts as "yesterday" is theirs.
-- Days after it are ignored, so a player a timezone ahead is not counted as
-- having played a puzzle the reader cannot see yet.
--
-- The same shape as `leaderboard_board`: the top `p_limit` rows (clamped to 999,
-- see 20261014030000), plus `p_player`'s own row from below the cut.

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
    select distinct s.player_id, s.puzzle_date
    from public.leaderboard_scores s
    join active a on a.player_id = s.player_id
    where s.puzzle_date <= p_today
  ),
  breaks as (
    select
      d.player_id,
      d.puzzle_date,
      -- A gap of one missed day (two calendar days) is frozen over; anything
      -- wider starts a new run.
      case
        when d.puzzle_date - lag(d.puzzle_date) over (
          partition by d.player_id order by d.puzzle_date
        ) <= 2 then 0
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
