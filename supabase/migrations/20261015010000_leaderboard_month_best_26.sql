-- The monthly board counts a player's best 26 puzzles of the month, not every
-- one of them.
--
-- MONTHLY BOARD RULE: a month's total is the sum of each player's 26 highest
-- daily totals inside that calendar month. Summing every day made the board a
-- test of attendance first -- a missed day was a whole puzzle down on everybody
-- who played it, and a 31-day month was worth more than February. Capping it at
-- 26 leaves room for a few days off (two in February, five in a 31-day month),
-- and every day past the 26th still helps by replacing a worse one. It is the
-- weekly board's best-four-of-seven rule (20261006120000) applied to the month.
--
-- Ties between a player's days break to the earlier puzzle, `puzzles` reports
-- the days that counted (at most 26), and the window word is still the rarest
-- find across every day played -- all of that is `leaderboard_board`'s existing
-- `p_best` handling. `lastMonth` is ranked by the same rule, so the winner it
-- names is the one its board showed.
--
-- From October 2026 on only. A month that starts before 2026-10-01 keeps
-- counting every day played (`p_best` null), so September and earlier read
-- exactly as they were ranked at the time; October is the first month ranked by
-- best 26. The cutover is the month's own first day, compared in SQL below, and
-- mirrored by MONTH_BEST_DAYS_START in src/game/month.ts.
--
-- Only `leaderboard_boards` changes, and only by passing `p_best` = 26 to the
-- monthly board (`allTime`, fed the month as `p_season_*`) and to `lastMonth`.
-- 26 lives here and in src/game/month.ts (MONTH_BEST_DAYS), which the client's
-- own shared month total uses; the two have to agree.

/*
 * Both boards and the finds, for one mode.
 *
 * The weekly board and last week's winner count each player's best four days;
 * the monthly board and last month's winner count each player's best 26, for
 * months from October 2026 on (every day before that).
 * Everything else is unchanged from 20261006120000.
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
  p_week_until date default null,
  p_mode text default 'standard'
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit, p_player, p_week_until, p_mode, 4) b
    ) else '[]'::jsonb end,
    -- The monthly board: each player's best 26 puzzles of the month, from
    -- October 2026 on; every puzzle for a month before that.
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(
        p_season_since, p_limit, p_player, p_season_until, p_mode,
        case when p_season_since >= date '2026-10-01' then 26 end
      ) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final, on this board -- by
    -- the same best-four rule, so the winner named is the one its board shows.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1, p_mode, 4) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    -- The same for the calendar month before the reader's own, when the caller
    -- names one -- by the same best-26 rule as the monthly board, with the same
    -- October 2026 start.
    'lastMonth', case when coalesce(p_open, false) and p_month_since is not null then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(
        p_month_since, 1, null, p_month_until, p_mode,
        case when p_month_since >= date '2026-10-01' then 26 end
      ) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    'words', case when p_words_before is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      from public.leaderboard_words(p_words_before, p_words_since, 12) w
    ) end
  );
$$;

revoke all on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date, date, text)
  from public, anon, authenticated;
grant execute on function public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date, date, text)
  to service_role;
