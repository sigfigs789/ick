-- A board is a top fifteen, plus your own row when you are not in it -- and the
-- second board is a season rather than all of time.
--
-- Fifty rows was a list you scrolled; fifteen is a list you read. But a cut-off
-- board is only worth having if it can still answer "where am I", which for
-- almost everybody is somewhere below the cut -- so the board query now takes
-- the player asking, and returns their row alongside the top however far down it
-- sits. The rank on it is their real one, computed over everybody, not a
-- position inside the fifteen.
--
-- One query rather than a board query and a rank query: the ranking is the same
-- window function either way, and asking twice invites the two answers to
-- disagree across a write landing between them.
--
-- The window also closes at the top now. The second board is named for a season
-- with two dates on it, so it has to be bounded at both ends or the name is a
-- lie -- an early player's July puzzles would land inside "Season 1", and every
-- puzzle after New Year would keep landing there too. `p_until` is the other
-- half of `p_since`, and the caller supplies both.
--
-- Both functions are dropped and recreated rather than replaced: each gains a
-- parameter, and a differing argument list makes a new overload rather than
-- replacing the old one, which would leave PostgREST two candidates to choose
-- between.

drop function if exists public.leaderboard_boards(date, integer, boolean, date, date);
drop function if exists public.leaderboard_board(date, integer);

/*
 * One board, aggregated over a date window.
 *
 * `p_since` / `p_until` bound the window; either one null means unbounded that
 * way. A date means "on or after" / "on or before", which is how the weekly
 * board gets its reset -- nothing is deleted or archived when a week turns over,
 * the window simply moves and last week's rows fall out of it. That keeps the
 * season board a straight sum of the same rows and makes the weekly reset
 * unlosable: there is no scheduled job that can fail to run. It is also how a
 * season ends: the window stops moving, and the board it leaves behind is the
 * final one.
 *
 * Nothing here knows which day the week starts on. The caller computes the
 * window's first day from the player's own calendar (src/game/week.ts, currently
 * Sunday) and passes it in, so moving the boundary is a one-file change and
 * never a migration.
 *
 * Ranked by summed total score, which rewards playing every day rather than
 * peaking once -- the intended shape for a daily game. Ties break on the rarest
 * word found in the window, then on who got there first, so a rank is always
 * determinate. The rank is returned rather than left for a caller to infer from
 * row order: it is what the page displays, so the database that decided the
 * ordering is the thing that should say it -- and it is the only way the row
 * below the cut can say anything true about itself.
 *
 * Returns the first `p_limit` rows, and `p_player`'s own row when that player
 * ranks below them. Everybody is ranked first and the cut is applied after, so a
 * player at 400 comes back as 400. The extra row sorts last by construction --
 * its rank is greater than every row above the cut -- so a caller can split the
 * result on the limit without re-sorting anything.
 *
 * `window_word` / `window_zipf` is the rarest word the player found *inside* the
 * window: on the weekly board what they turned up this week, on the season board
 * their best of the season. The page does not show it at present -- the scoring
 * system is still being corrected and a find is displayed with what it scored --
 * but it stays in the answer, because holding a column back from a screen is a
 * component's decision and not a query's. No name comes back at all -- the client
 * derives a handle from the player id (see src/game/handle.ts), so there is
 * nothing to store, keep in step, or authorise.
 *
 * The word is picked by smallest Zipf, which needs no dictionary here: every
 * scoring system this game has used maps Zipf to score monotonically downward, so
 * the smallest Zipf is the rarest word under any of them. Scores are the client's
 * job -- it has the dictionary, and it can apply today's.
 */
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
      round(sum(s.total_score), 1) as total_score,
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

revoke all on function public.leaderboard_board(date, integer, uuid, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date) to service_role;

/*
 * Both boards, and the gate in front of them.
 *
 * Scores are collected from the first day and the boards are published on a
 * chosen date, whatever the data looks like by then. `p_open` carries that
 * decision, made by the endpoint from the calendar rather than from the size of
 * the table -- a launch nobody can put a date on is one nobody plans around.
 *
 * The gate still lives here rather than only in the page: while it is shut, no
 * board row leaves the database at all, so there is no early board sitting in an
 * API response waiting to be read out of the network tab. That covers the row
 * below the cut too -- a player's own rank is a board row like any other, and
 * arrives no earlier than the board it belongs to.
 *
 * One function returning JSON rather than three calls: the count and both boards
 * are one question ("what should this page show right now"), and answering it in
 * one round trip means the count can never disagree with the rows beside it.
 *
 * `p_player` is the player asking, or null for a caller who is nobody in
 * particular -- a board with no row below the cut is exactly what that should
 * return, so the parameter is optional in the plainest way.
 *
 * `p_season_since` / `p_season_until` bound the second board. Nothing here knows
 * when a season runs, the same way nothing here knows which day a week starts
 * on: the endpoint holds the dates and passes them, so opening Season 2 is a
 * two-line change and never a migration. Both null is the old behaviour -- every
 * puzzle ever, added up.
 */
create or replace function public.leaderboard_boards(
  p_since date,
  p_limit integer default 15,
  p_open boolean default false,
  p_words_before date default null,
  p_words_since date default null,
  p_player uuid default null,
  p_season_since date default null,
  p_season_until date default null
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    -- Aggregated in rank order, so the array a caller receives is already the
    -- board top to bottom -- with the asking player's row, if it is here at all,
    -- last. Nothing downstream has to re-sort it.
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit, p_player, null) b
    ) else '[]'::jsonb end,
    -- Still called `allTime` in the response: the key is what the two boards are
    -- to a caller -- the short window and the long one -- and renaming it would
    -- have every future season rename it again.
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until) b
    ) else '[]'::jsonb end,
    -- Deliberately *outside* the gate: the finds feed works from day one, and
    -- it is the best thing to show a player while the boards wait for their
    -- opening date.
    'words', case when p_words_before is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      from public.leaderboard_words(p_words_before, p_words_since, 12) w
    ) end
  );
$$;

revoke all on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date)
  to service_role;
