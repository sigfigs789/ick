-- The boards' totals, to hundredths.
--
-- A day's score is a sum of words priced to the cent: a deep-tail find is 9.95,
-- not 9.9 or 10. The board rounded that sum to one decimal, and the client
-- rounded it to one decimal again before submitting it, so a day of
-- 10 + 9.95 + 10 + 10 arrived, was stored and was displayed as a flat 40 --
-- 39.95 landing exactly on the half and rounding up, into a number no player
-- could add their own finds up to.
--
-- Two decimals here rather than none, for the same reason a tenth was chosen
-- over none in the first place: `sum` over a numeric column is exact, but the
-- values it adds arrived as JSON floats, and the endpoint stores them rounded
-- to hundredths (see api/leaderboard.ts). Rounding the sum to the precision of
-- its own inputs is what keeps a week's total from reading as 73.65000000000001,
-- and is now the precision the page prints (see `formatTotal`).
--
-- Only the aggregate changes. Ranking, tie-breaks, the window word, the bound
-- and the row-below-the-cut all stay exactly as they were; a redefinition
-- rather than a new function, so `leaderboard_boards` and
-- `leaderboard_public_board` pick this up without being touched.
--
-- Days already stored keep the tenth they were written with -- the 40 above is
-- 40 for good, because the 39.95 that produced it was rounded away on the
-- client before it ever left the browser. What this fixes is every day written
-- from here on.

create or replace function public.leaderboard_board(
  p_since date default null,
  p_limit integer default 15,
  p_player uuid default null,
  p_until date default null
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
as $$
  -- The window: what they scored, and the rarest thing they found, inside it.
  with windowed as (
    select
      s.player_id,
      round(sum(s.total_score), 2) as total_score,
      count(*)::integer as puzzles,
      min(s.created_at) as joined_at,
      -- The rarest word of the window, and its Zipf. Picked together so the word
      -- and the number always describe each other.
      (array_agg(s.top_word order by s.top_zipf asc, s.puzzle_date asc))[1] as window_word,
      min(s.top_zipf) as window_zipf
    from public.leaderboard_scores s
    where (p_since is null or s.puzzle_date >= p_since)
      and (p_until is null or s.puzzle_date <= p_until)
    group by s.player_id
  ),
  -- Ranked over everybody before anything is cut, which is what makes the row
  -- below the cut worth returning: its rank is its real standing.
  ranked as (
    select
      row_number() over (
        order by w.total_score desc, w.window_zipf asc, w.joined_at asc
      )::integer as rank,
      w.player_id,
      w.window_word,
      w.window_zipf,
      w.total_score,
      w.puzzles
    from windowed w
  )
  select r.rank, r.player_id, r.window_word, r.window_zipf, r.total_score, r.puzzles
  from ranked r
  -- Bounded here rather than with LIMIT, because the asking player's row has to
  -- come back from below it.
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 200)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

-- `create or replace` keeps the existing grants, but this project has been
-- bitten by assuming a role kept a grant it only ever held through PUBLIC, so
-- the door is stated rather than inherited: nobody but service_role, which is
-- the endpoint, and the two `security definer` wrappers that anon calls (see
-- 20260911060000) which run as their owner rather than as the caller.
revoke all on function public.leaderboard_board(date, integer, uuid, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date) to service_role;
