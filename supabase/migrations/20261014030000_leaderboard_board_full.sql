-- The boards show everybody, not a top fifteen.
--
-- The page now asks for the whole daily, weekly and monthly board, but this
-- function clamped every request to 200 rows -- and a player ranked 201st or
-- lower would then come back as a board row (their rank under the API's own
-- limit) rather than as the row below the cut. The clamp moves to 999, which is
-- api/leaderboard.ts's MAX_LIMIT: the two have to agree, and a test reads this
-- file to hold them to it.
--
-- 999 rather than 1000 because the daily board is read straight off this
-- function as a set of rows, and PostgREST stops a set at max_rows (1000, the
-- hosted default and supabase/config.toml's). 999 board rows plus the asker's
-- own row below them is 1000, so the row that says where they stand is never
-- the one cut off.
--
-- `create or replace` with the same signature and return type, so requests in
-- flight keep working; the grants are restated anyway, since service_role's is
-- not something to leave to inheritance. `leaderboard_public_board` (the Reddit
-- import) keeps its own 200 clamp and is untouched.

create or replace function public.leaderboard_board(
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
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 999)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  to service_role;
