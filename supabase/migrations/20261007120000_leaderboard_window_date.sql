-- The board names the puzzle its window word was found on.
--
-- A board row carried the rarest word in the window and its Zipf, and the
-- client priced that Zipf with no date -- so with the newest undated profile,
-- whatever system the word was actually scored under. From the 0.3 lift
-- (SCORE_LIFT_START, 2026-10-09) those differ: a find shown 9.2 Elusive in the
-- game would read 8.9 beside the finder's name. `window_date` is the puzzle the
-- window word came from, chosen by the same ordering as the word, so the
-- client can price it by that day's rules.
--
-- Added as the last column, because `leaderboard_public_board` reads this
-- function with `select *` into a fixed six-column table. It is replaced below
-- to name its six columns, so the Reddit import's shape does not change.
-- `leaderboard_boards` serialises rows with to_jsonb, so it carries the new
-- key with no change of its own.

drop function if exists public.leaderboard_board(date, integer, uuid, date, text, integer);

create function public.leaderboard_board(
  p_since date default null,
  p_limit integer default 15,
  p_player uuid default null,
  p_until date default null,
  p_mode text default 'standard',
  p_best integer default null
) returns table (
  rank integer,
  player_id uuid,
  window_word text,
  window_zipf numeric,
  total_score numeric,
  puzzles integer,
  window_date date
)
language sql
stable
as $$
  with days as (
    select
      s.player_id,
      s.puzzle_date,
      s.total_score,
      s.top_word,
      s.top_zipf,
      s.created_at,
      -- Each player's days, best first: the first `p_best` of these are the
      -- ones the total counts.
      row_number() over (
        partition by s.player_id
        order by s.total_score desc, s.puzzle_date asc
      ) as day_rank
    from public.leaderboard_scores s
    where (p_since is null or s.puzzle_date >= p_since)
      and (p_until is null or s.puzzle_date <= p_until)
      -- This board's own days, and the days that belong to every board.
      and s.mode in (
        'shared',
        case when p_mode = 'freeform' then 'freeform' else 'standard' end
      )
  ),
  windowed as (
    select
      d.player_id,
      round(sum(d.total_score) filter (
        where p_best is null or d.day_rank <= p_best
      ), 2) as total_score,
      (count(*) filter (
        where p_best is null or d.day_rank <= p_best
      ))::integer as puzzles,
      min(d.created_at) as joined_at,
      (array_agg(d.top_word order by d.top_zipf asc, d.puzzle_date asc))[1] as window_word,
      min(d.top_zipf) as window_zipf,
      -- The puzzle the window word was found on, picked by the same ordering
      -- as the word itself so the two always describe one find.
      (array_agg(d.puzzle_date order by d.top_zipf asc, d.puzzle_date asc))[1] as window_date
    from days d
    group by d.player_id
  ),
  ranked as (
    select
      row_number() over (
        order by w.total_score desc, w.window_zipf asc, w.joined_at asc
      )::integer as rank,
      w.player_id,
      w.window_word,
      w.window_zipf,
      w.total_score,
      w.puzzles,
      w.window_date
    from windowed w
  )
  select r.rank, r.player_id, r.window_word, r.window_zipf, r.total_score, r.puzzles, r.window_date
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 200)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  to service_role;

-- Named columns rather than `select *`, so the board growing a column (as it
-- just did) never changes what the Reddit import reads.
create or replace function public.leaderboard_public_board(
  p_since date default null,
  p_limit integer default 200,
  p_mode text default 'standard'
) returns table (
  rank integer,
  player_id uuid,
  window_word text,
  window_zipf numeric,
  total_score numeric,
  puzzles integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.rank, b.player_id, b.window_word, b.window_zipf, b.total_score, b.puzzles
  from public.leaderboard_board(
    p_since, least(greatest(coalesce(p_limit, 200), 1), 200), null, null, p_mode
  ) b;
$$;

revoke all on function public.leaderboard_public_board(date, integer, text)
  from public, anon, authenticated;
grant execute on function public.leaderboard_public_board(date, integer, text) to anon, service_role;
