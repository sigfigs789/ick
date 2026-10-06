-- The weekly board counts a player's best four days of the seven, down from
-- five (20261005010000_leaderboard_week_best_five.sql).
--
-- Four of seven leaves room for three days off, and every day past the fourth
-- still helps by replacing a worse one. The rule is otherwise unchanged: ties
-- broken by the earlier puzzle, `puzzles` reports the days that counted, and the
-- window word is still the rarest find across every day played. `lastWeek` is
-- ranked by the same rule, and so is every past week a reader steps back to.
--
-- Only `leaderboard_boards` changes, and only the number it passes as
-- `p_best`; `leaderboard_board` already takes it. Four lives here and in
-- src/game/week.ts (WEEK_BEST_DAYS), which the client's own week total uses.

/*
 * Both boards and the finds, for one mode.
 *
 * The weekly board and last week's winner count each player's best four days;
 * everything else is unchanged from 20261005010000.
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
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until, p_mode) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final, on this board -- by
    -- the same best-four rule, so the winner named is the one its board shows.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1, p_mode, 4) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    -- The same for the calendar month before the reader's own, when the caller
    -- names one.
    'lastMonth', case when coalesce(p_open, false) and p_month_since is not null then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_month_since, 1, null, p_month_until, p_mode) b
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
