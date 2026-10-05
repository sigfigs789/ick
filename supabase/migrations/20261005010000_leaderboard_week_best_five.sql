-- The weekly board counts a player's best five days of the seven.
--
-- A week's total was the sum of every day played in it, which made the weekly
-- board a test of attendance before it was a test of finds: a player who missed
-- a day was a whole puzzle down on everybody who didn't, and one who missed two
-- could not catch a merely steady player however rare their words were. Five of
-- seven leaves room for two days off -- a weekend away, a busy Tuesday -- and
-- still rewards turning up, because a sixth and seventh day can only replace a
-- worse one.
--
-- The window is unchanged: Sunday to Saturday, stepped back a week at a time,
-- and `lastWeek` -- the closed week the congratulation names -- is the same
-- seven days before `p_since` it always was, now ranked by the same rule as the
-- board it is the winner of. Every week is counted this way, past ones
-- included, so a reader stepping back reads the board the same rule would have
-- produced then.
--
-- The day and month boards are unchanged: `p_best` defaults to null, which
-- counts every day, and only the two weekly calls below pass a number.
--
-- Five lives here and in src/game/week.ts (WEEK_BEST_DAYS), which the client's
-- own week total uses so a shared result agrees with the board. Two homes for
-- one constant, for the reason `leaderboard_mode_split` gives: the database
-- cannot import the module.
--
-- What a counted day is: the player's highest-scoring days in the window, ties
-- broken by the earlier puzzle. `puzzles` reports the days that counted, so a
-- row reading "5 puzzles" is the five its total is the sum of. The window word
-- is still the rarest find across every day played -- it is what they turned up
-- this week, and a day that did not make the five still found it.
--
-- `leaderboard_board` grows a parameter, so it is dropped and recreated rather
-- than replaced (a differing argument list would make a second overload, and
-- PostgREST would have two to choose between). `leaderboard_public_board` calls
-- it positionally with five arguments and picks up the default without being
-- touched; `leaderboard_boards` is replaced below with the same signature.

drop function if exists public.leaderboard_board(date, integer, uuid, date, text);

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
  puzzles integer
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
      min(d.top_zipf) as window_zipf
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
      w.puzzles
    from windowed w
  )
  select r.rank, r.player_id, r.window_word, r.window_zipf, r.total_score, r.puzzles
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 15), 1), 200)
     or (p_player is not null and r.player_id = p_player)
  order by r.rank;
$$;

revoke all on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date, text, integer)
  to service_role;

/*
 * Both boards and the finds, for one mode.
 *
 * The weekly board and last week's winner count each player's best five days;
 * everything else is unchanged from 20260925000000.
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
      from public.leaderboard_board(p_since, p_limit, p_player, p_week_until, p_mode, 5) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until, p_mode) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final, on this board -- by
    -- the same best-five rule, so the winner named is the one its board shows.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1, p_mode, 5) b
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
