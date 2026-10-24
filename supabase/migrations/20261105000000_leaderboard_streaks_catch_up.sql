-- A run the saved freezes cannot cover is not over yet: the last two missed
-- days (yesterday and the day before) can still be made up by playing their
-- puzzles late (see `catchUpDays` in src/game/streakFreeze.ts). So the streak
-- board stops killing a run the day its freezes run out.
--
-- For the first two days missed past the saved freezes the run is `endangered`:
-- still listed and still ranked, at the length it reached, and shown ⚠️ where
-- the day before it was ⏳. Only after that is it `lost` (💀), listed for two
-- more days, and then it leaves the board.
--
-- A day made up reaches the board through `saved_freezes`: the game counts
-- every day made up since the last day played as one more saved (see
-- `streakReport`), and re-sends its report with the archive puzzle's words.
--
-- The dead-streaks board waits the same two days before listing a run.
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
      -- Two missed days past the freezes can still be made up.
      g.missed > g.saved_freezes + 2 as lost,
      g.missed > g.saved_freezes and g.missed <= g.saved_freezes + 2 as endangered,
      g.resting
    from gaps g
    -- Alive or endangered; a run past that stays listed for its first two
    -- days lost, if it was a streak.
    where g.missed <= g.saved_freezes + 2
       or (g.missed <= g.saved_freezes + 4 and g.current_streak >= 2)
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

-- Unchanged from 20261017000000 but for the days a run is given: it is dead
-- once the days missed are more than its saved freezes plus the two that can
-- be made up (the free day it was given before is gone).
create or replace function public.leaderboard_dead_streaks(
  p_today date,
  p_limit integer default 100
) returns table (
  rank integer,
  player_id uuid,
  lost_streak integer,
  best_streak integer,
  last_played date,
  days_played integer
)
language sql
stable
as $$
  with players as (
    -- One aggregate over the scores, which the primary key (player_id,
    -- puzzle_date, mode) can answer; the per-day rows and window functions
    -- below run only for the players this narrows to.
    select
      s.player_id,
      count(distinct s.puzzle_date)::integer as days_played,
      max(s.puzzle_date) as last_played
    from public.leaderboard_scores s
    where s.puzzle_date <= p_today
    group by s.player_id
    having count(distinct s.puzzle_date) >= 2
  ),
  gone as (
    select
      p.player_id,
      p.days_played,
      p.last_played,
      -- The game's report, only when it describes the same last day played.
      case when r.last_played = p.last_played then r.current_streak end as reported_lost,
      case when r.last_played = p.last_played then r.best_streak end as reported_best
    from players p
    left join public.leaderboard_player_streaks r on r.player_id = p.player_id
    -- Past the saved freezes and the two days that can still be made up.
    where (p_today - 1) - p.last_played > 2 + case
      when r.last_played = p.last_played then r.saved_freezes
      -- No report for the last day played (a failed streak write, or a game
      -- too old to send one): assume the most a streak can hold, so a run the
      -- game still shows as frozen is never listed here. Saved freezes did not
      -- exist before 2026-10-15, so a run that ended earlier had none.
      when p.last_played >= date '2026-10-15' then 2
      else 0
    end
  ),
  days as (
    -- One row per day played, either mode, keeping the earliest arrival.
    select s.player_id, s.puzzle_date, min(s.created_at) as first_played_at
    from public.leaderboard_scores s
    join gone g on g.player_id = s.player_id
    where s.puzzle_date <= p_today
    group by s.player_id, s.puzzle_date
  ),
  breaks as (
    select
      d.player_id,
      d.puzzle_date,
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
      sum(b.starts_run) over (partition by b.player_id order by b.puzzle_date) as run
    from breaks b
  ),
  streaks as (
    select r.player_id, count(*)::integer as length, max(r.puzzle_date) as ended
    from runs r
    group by r.player_id, r.run
  ),
  per_player as (
    select
      g.player_id,
      g.days_played,
      g.last_played,
      coalesce(
        g.reported_lost,
        max(st.length) filter (where st.ended = g.last_played)
      ) as lost_streak,
      greatest(max(st.length), coalesce(g.reported_best, 0)) as best_streak
    from gone g
    join streaks st on st.player_id = g.player_id
    group by g.player_id, g.days_played, g.last_played, g.reported_lost, g.reported_best
  ),
  ranked as (
    select
      row_number() over (
        order by p.best_streak desc, p.lost_streak desc, p.last_played desc, p.player_id
      )::integer as rank,
      p.player_id,
      p.lost_streak,
      greatest(p.best_streak, p.lost_streak) as best_streak,
      p.last_played,
      p.days_played
    from per_player p
  )
  select r.rank, r.player_id, r.lost_streak, r.best_streak, r.last_played, r.days_played
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 100), 1), 999)
  order by r.rank;
$$;

revoke all on function public.leaderboard_dead_streaks(date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_dead_streaks(date, integer)
  to service_role;
