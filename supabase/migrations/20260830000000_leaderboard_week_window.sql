-- The weekly board gets a far end, so it can be a week that has finished.
--
-- Until now the weekly board was always the live week, and a live week needs no
-- upper bound: "everything from Sunday onward" and "the seven days from Sunday"
-- are the same set of rows when no puzzle past today exists. The page can now
-- step either board back through closed windows and forward again, and the
-- moment `p_since` can be a Sunday in the past those two stop being the same
-- set: an unbounded window would answer "the week of the 16th" with every score
-- since the 16th, and every week a reader stepped back to would be a bigger
-- board than the one they left.
--
-- So the weekly board takes the same pair of bounds the monthly one has had
-- since it was a season: `p_week_until` is the other half of `p_since`, and the
-- endpoint supplies it (api/leaderboard.ts, `weekEnd`) exactly as it supplies
-- the month's. Nothing here learns how long a week is or which day it starts
-- on; both remain the client's to decide (src/game/week.ts).
--
-- Null keeps the old behaviour, unbounded, which is what a caller deployed
-- before this migration sends -- so this function is safe to land ahead of the
-- endpoint that uses it, and must be, since PostgREST refuses a call naming a
-- parameter the function does not have.
--
-- Dropped and recreated rather than replaced: the argument list grows, and a
-- differing one makes a second overload rather than replacing the first, which
-- would leave PostgREST two candidates to choose between.

drop function if exists public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date);

/*
 * Both boards, and each board's last completed window.
 *
 * Unchanged from 20260829000000_leaderboard_champions.sql except that the
 * weekly board is now bounded at `p_week_until` instead of at nothing. See that
 * migration for the champions, 20260826000000_leaderboard_top_and_self.sql for
 * the gate, the row below the cut, and why the long board is still called
 * `allTime` in the response.
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
  p_month_until date default null,
  p_week_until date default null
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit, p_player, p_week_until) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final: from seven days
    -- before its first day, through the day before it. Derived from `p_since`
    -- like before, so a board a reader has stepped back to carries the plaque of
    -- the week before *it* rather than of the week before this one.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
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

-- Granted explicitly to service_role rather than left to the revoke above: a
-- fresh database gets no grant from a REVOKE, and this signature is new.
revoke all on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date, date)
  to service_role;
