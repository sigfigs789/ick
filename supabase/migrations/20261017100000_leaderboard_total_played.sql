-- The puzzles-played board, at /leaderboard-total: every player, most puzzles
-- played first.
--
-- A puzzle played is a puzzle date with a row in leaderboard_scores, in either
-- mode -- a day played both ways counts once, as it does for the streak. Days
-- kept off the boards (archive play, `unranked`) never reach that table, so
-- they are not counted here either.
--
-- Ties go to the longer-standing player (the earlier first day), then to
-- whoever played most recently.
--
-- Same clamp and same row-below-the-cut as `leaderboard_board`
-- (20261014030000): the top `p_limit`, plus `p_player`'s own row from below it.

create or replace function public.leaderboard_total_played(
  p_limit integer default 999,
  p_player uuid default null
) returns table (
  rank integer,
  player_id uuid,
  puzzles integer,
  first_played date,
  last_played date
)
language sql
stable
as $$
  with players as (
    select
      s.player_id,
      count(distinct s.puzzle_date)::integer as puzzles,
      min(s.puzzle_date) as first_played,
      max(s.puzzle_date) as last_played
    from public.leaderboard_scores s
    group by s.player_id
  ),
  ranked as (
    select
      row_number() over (
        order by p.puzzles desc, p.first_played asc, p.last_played desc, p.player_id
      )::integer as rank,
      p.player_id,
      p.puzzles,
      p.first_played,
      p.last_played
    from players p
  )
  select r.rank, r.player_id, r.puzzles, r.first_played, r.last_played
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 999), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_total_played(integer, uuid)
  from public, anon, authenticated;
-- Granted to service_role explicitly: it inherits nothing (see 20260825000000).
grant execute on function public.leaderboard_total_played(integer, uuid)
  to service_role;
