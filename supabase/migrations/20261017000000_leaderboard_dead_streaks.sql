-- The dead-streaks board: players whose streak ended and who never came back.
--
-- A streak is dead when the days missed since the player's last day played are
-- more than the one free day plus the freezes they had saved -- the same rule
-- `leaderboard_streaks` keeps a run alive by (20261016000000). "Never came
-- back" falls out of it: a player who returned has a later last day played, and
-- their run is either alive or ended later and is judged from there.
--
-- A player with one day played is left off: one puzzle is a visit, not a
-- streak that was lost.
--
-- Without a report for that last day, the saved freezes are taken as the
-- most a streak can hold (2), so the board waits until the run is certainly
-- over rather than guessing it is.
--
-- The run lengths come from the game's own report when it is about the same
-- last day played (most players who died before reports existed have none),
-- and otherwise from the days in leaderboard_scores by the free-day rule the
-- game has used since 2026-10-05 16:35 UTC (see 20261015210000).

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
  with days as (
    -- One row per day played, either mode, keeping the earliest arrival.
    select s.player_id, s.puzzle_date, min(s.created_at) as first_played_at
    from public.leaderboard_scores s
    where s.puzzle_date <= p_today
    group by s.player_id, s.puzzle_date
  ),
  players as (
    select d.player_id, count(*)::integer as days_played, max(d.puzzle_date) as last_played
    from days d
    group by d.player_id
    having count(*) >= 2
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
    where (p_today - 1) - p.last_played > 1 + case
      when r.last_played = p.last_played then r.saved_freezes
      -- No report for the last day played (a failed streak write, or a game
      -- too old to send one): assume the most a streak can hold, so a run the
      -- game still shows as frozen is never listed here. Saved freezes did not
      -- exist before 2026-10-15, so a run that ended earlier had none.
      when p.last_played >= date '2026-10-15' then 2
      else 0
    end
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
    join gone g on g.player_id = d.player_id
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
