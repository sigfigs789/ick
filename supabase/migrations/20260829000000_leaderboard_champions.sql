-- Who won last week, and who won last month.
--
-- The two boards on the page are both live windows: "this week" resets under the
-- reader every Sunday, and the season runs to New Year. Nothing on the page ever
-- said how either of them *finished*, so a week somebody won vanished at
-- midnight -- the window moved, their rows fell out of it, and the only record
-- that they had topped a board was in their own memory. A champion line under
-- each board is that record: one name, one score, and the window it belongs to.
--
-- Both are read with `leaderboard_board`, which already takes an arbitrary
-- window and ranks it -- a champion is that board asked for one row. So this
-- migration adds no ranking logic of its own; it only names two more windows.
--
-- The previous week is derived here rather than passed, because it is the one
-- window arithmetic forces: it is exactly the seven days before the window the
-- caller already sent, whichever day that caller starts its weeks on. Nothing
-- here learns what a week is that it did not know before.
--
-- The month is passed, because it cannot be derived: `p_since` is a Sunday, and
-- the Sunday bracketing the 1st of a month belongs to the month before it -- so
-- deriving a month from it would name the wrong one for the first days of every
-- month. The endpoint holds those dates, the same way it holds the season's.
--
-- Dropped and recreated rather than replaced: the argument list grows, and a
-- differing one makes a second overload rather than replacing the first, which
-- would leave PostgREST two candidates to choose between.

drop function if exists public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date);

/*
 * Both boards, the finds, and each board's last completed window.
 *
 * `lastWeek` is the player who topped the seven days before `p_since`;
 * `lastMonth` is the player who topped `p_month_since` .. `p_month_until`. Each
 * is one row -- `leaderboard_board` asked for a top one -- or JSON null when
 * nobody scored in that window at all, which is a state the page has to render
 * anyway (a brand new season, a month before the game existed).
 *
 * A row and not a name: it carries the same columns every other board row does,
 * so the page prices and labels a champion with exactly the code that renders a
 * board row, and the two can never disagree about what a score looks like.
 *
 * The rest is unchanged from the previous version -- see
 * 20260826000000_leaderboard_top_and_self.sql for the gate, the season bounds,
 * and why the long board is still called `allTime` in the response.
 */
create or replace function public.leaderboard_boards(
  p_since date,
  p_limit integer default 15,
  p_open boolean default false,
  p_words_before date default null,
  p_words_since date default null,
  p_player uuid default null,
  p_season_since date default null,
  p_season_until date default null,
  p_month_since date default null,
  p_month_until date default null
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit, p_player, null) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final: from seven days
    -- before its first day, through the day before it. Behind the same gate as
    -- the board it belongs under -- a champion is a board row, and no board row
    -- leaves the database while the gate is shut.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1) b
      -- `p_limit` of 1 already cuts it to the winner; the guard is against the
      -- one other row that function can return, which is the asking player's
      -- from below the cut. None is asked for here (`p_player` is null), and
      -- saying so costs nothing.
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    -- The same for the calendar month before the reader's own, when the caller
    -- names one. Null rather than an omitted key either way, so the page has one
    -- shape to read.
    'lastMonth', case when coalesce(p_open, false) and p_month_since is not null then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_month_since, 1, null, p_month_until) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    'words', case when p_words_before is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      from public.leaderboard_words(p_words_before, p_words_since, 12) w
    ) end
  );
$$;

-- Granted explicitly to service_role rather than left to the revoke above:
-- a fresh database gets no grant from a REVOKE, and this is a new function.
revoke all on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date)
  to service_role;
