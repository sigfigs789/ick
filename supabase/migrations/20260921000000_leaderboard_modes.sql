-- Two sets of boards: Standard and Freeform.
--
-- Freeform began as a week (see src/game/dictionary.ts, FREEFORM_START) -- the
-- scoring fold switched off for everybody at once, so one board still meant one
-- thing on any given day. From 2026-09-27 it is a mode the player picks and the
-- game remembers, which one board cannot survive: Freeform scores every word on
-- its own frequency and hands out a Legend where Standard folds the word onto
-- its common form, so a Freeform afternoon outranks a Standard week. Ranking
-- them together would not be a leaderboard, it would be a list of who had the
-- switch on.
--
-- So a score belongs to a mode, and a player can hold a row on both boards for
-- the same puzzle -- each mode gives them a full set of guesses (see
-- src/game/storage.ts), and each set of guesses is a day's play.
--
-- Three parts:
--   1. `mode` on leaderboard_scores, with the primary key widened to include it.
--   2. The existing rows filed where they were actually played: the trial
--      window's days are Freeform, and everything either side of them Standard.
--   3. Mode-aware readers, under new names.
--
-- New names rather than new parameters on the existing functions, and that is
-- deliberate. A default parameter added to `leaderboard_board` would create an
-- overload rather than replace it, and Postgres refuses an ambiguous call -- so
-- every request in flight during the deploy would fail on "function is not
-- unique". `_scoped` is the same query with the mode bound. The originals keep
-- their signatures and are redefined at the bottom of this file to delegate to
-- the scoped ones with 'standard' -- so the public read wrapper that anon calls
-- and the Reddit build's merged board go on working, and what they mean by "the
-- board" is now Standard's.

alter table public.leaderboard_scores
  add column if not exists mode text not null default 'standard'
    check (mode in ('standard', 'freeform'));

comment on column public.leaderboard_scores.mode is
  'Which rule set this day was played under. One row per player per puzzle per mode.';

-- Existing rows, filed where they were played rather than where the default put
-- them. The trial ran 2026-09-14 through 2026-09-26 with everybody on freeform
-- rules, so those days are freeform scores and belong on the freeform board;
-- leaving them under the default would put two weeks of unfolded scores at the
-- top of Standard's board permanently.
--
-- Bounded at both ends and run once: from 2026-09-27 the mode is the player's
-- own and arrives on the submission, so there is nothing after this window for a
-- date to decide.
update public.leaderboard_scores
  set mode = 'freeform'
  where puzzle_date >= date '2026-09-14'
    and puzzle_date < date '2026-09-27'
    and mode = 'standard';

-- The key widens to hold both rows. Dropped and recreated rather than altered,
-- which is the only way to change a primary key's columns; the index behind it
-- is rebuilt with it.
alter table public.leaderboard_scores
  drop constraint if exists leaderboard_scores_pkey;
alter table public.leaderboard_scores
  add constraint leaderboard_scores_pkey primary key (player_id, puzzle_date, mode);

-- Every board query filters on mode and then scans a date window, so the mode
-- leads. The old date-only index stays: it still serves the unscoped functions
-- below, which ask no mode at all.
create index if not exists leaderboard_scores_mode_date_idx
  on public.leaderboard_scores (mode, puzzle_date desc);

/*
 * Submit a player's scores, now filed by mode.
 *
 * Same name and signature as before, so this replaces rather than overloads and
 * a client that sends no `mode` keeps working exactly as it did -- its days land
 * on the Standard board, which is what a client predating the switch meant by
 * "the board".
 *
 * Everything else is unchanged and unchanged on purpose: the monotonic-per-day
 * write, the retry retraction and its four cases, the `do nothing` on finds. The
 * only difference is that "a day" now means a day *in a mode*, so a player
 * playing both ways has two rows that rise independently and neither can lower
 * the other.
 *
 * The finds table is deliberately left whole. A word somebody found is a word
 * somebody found, and the feed is a record of what a drop turned up rather than
 * a ranking -- splitting it would halve the only page in the game whose whole
 * value is that everybody's finds are on it.
 */
create or replace function public.submit_leaderboard_scores(
  p_player_id uuid,
  p_scores jsonb
) returns integer
language sql
as $$
  with incoming as (
    select
      (s ->> 'date')::date as puzzle_date,
      -- Absent reads as standard, which is what every submission sent before
      -- this column existed meant. An unrecognised value would fail the check
      -- constraint rather than open a third board, but the endpoint has already
      -- refused it by then (see api/leaderboard.ts).
      coalesce(s ->> 'mode', 'standard') as mode,
      (s ->> 'word')::text as top_word,
      (s ->> 'zipf')::numeric as top_zipf,
      (s ->> 'total')::numeric as total_score,
      (s ->> 'top')::numeric as top_score,
      (s ->> 'words')::smallint as words,
      coalesce((s ->> 'retried')::boolean, false) as retried,
      s -> 'found' as found
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per day *and mode* before the insert sees it: a batch could name the
  -- same day twice, and ON CONFLICT cannot resolve a conflict against a row the
  -- same statement is still inserting. The post-retry entry outranks a pre-retry
  -- one whatever the two scores are, because it is the newer account of the day
  -- rather than the better one.
  deduped as (
    select distinct on (puzzle_date, mode)
      puzzle_date, mode, top_word, top_zipf, total_score, top_score, words, retried
    from incoming
    order by puzzle_date, mode, retried desc, total_score desc, top_zipf asc
  ),
  -- Written before the scores so a failure there cannot leave a day ranked with
  -- no words behind it. No mode: see the note above the function.
  finds as (
    select distinct on (i.puzzle_date, (f ->> 'word'))
      i.puzzle_date,
      (f ->> 'word')::text as word,
      (f ->> 'zipf')::numeric as zipf
    from incoming i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.found) = 'array' then i.found else '[]'::jsonb end
    ) as f
    order by i.puzzle_date, (f ->> 'word'), (f ->> 'zipf')::numeric asc
  ),
  found_written as (
    insert into public.leaderboard_finds (player_id, puzzle_date, word, zipf)
    select p_player_id, f.puzzle_date, f.word, f.zipf
    from finds f
    on conflict (player_id, puzzle_date, word) do nothing
    returning 1
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, mode, top_word, top_zipf, total_score, top_score, words, retried)
    select p_player_id, d.puzzle_date, d.mode, d.top_word, d.top_zipf,
           d.total_score, d.top_score, d.words, d.retried
    from deduped d
    on conflict (player_id, puzzle_date, mode) do update set
      total_score = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.total_score
        else greatest(public.leaderboard_scores.total_score, excluded.total_score) end,
      top_score = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.top_score
        else greatest(public.leaderboard_scores.top_score, excluded.top_score) end,
      words = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.words
        else greatest(public.leaderboard_scores.words, excluded.words) end,
      top_word = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_word else public.leaderboard_scores.top_word end,
      top_zipf = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_zipf else public.leaderboard_scores.top_zipf end,
      retried = public.leaderboard_scores.retried or excluded.retried,
      updated_at = now()
    where excluded.retried or not public.leaderboard_scores.retried
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_scores(uuid, jsonb) to service_role;

/*
 * One board, over a date window, in one mode.
 *
 * `leaderboard_board` with a mode bound, and otherwise line for line the same
 * query -- the ranking, the tie-breaks, the rank returned rather than inferred,
 * and the asking player's own row coming back from below the cut.
 *
 * A separate function rather than a parameter on the original: see the note at
 * the top of this file. The original stays, answering every caller that has no
 * mode to give it.
 */
create or replace function public.leaderboard_board_scoped(
  p_since date default null,
  p_limit integer default 15,
  p_player uuid default null,
  p_until date default null,
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
as $$
  with windowed as (
    select
      s.player_id,
      round(sum(s.total_score), 2) as total_score,
      count(*)::integer as puzzles,
      min(s.created_at) as joined_at,
      (array_agg(s.top_word order by s.top_zipf asc, s.puzzle_date asc))[1] as window_word,
      min(s.top_zipf) as window_zipf
    from public.leaderboard_scores s
    where s.mode = coalesce(p_mode, 'standard')
      and (p_since is null or s.puzzle_date >= p_since)
      and (p_until is null or s.puzzle_date <= p_until)
    group by s.player_id
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

revoke all on function public.leaderboard_board_scoped(date, integer, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board_scoped(date, integer, uuid, date, text)
  to service_role;

/*
 * The page's boards, in one mode and one round trip.
 *
 * `leaderboard_boards` with the mode threaded into each of the four calls it
 * makes. The champion lines under the weekly and monthly boards move with them:
 * whoever won last week won it in one mode, and naming Standard's champion under
 * Freeform's board would be a different player's week entirely.
 *
 * `words` is passed through untouched -- the finds feed is not split (see the
 * submit function above), so both modes' readers see the same list.
 */
create or replace function public.leaderboard_boards_scoped(
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
  p_mode text default 'standard'
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board_scoped(p_since, p_limit, p_player, null, p_mode) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board_scoped(
        p_season_since, p_limit, p_player, p_season_until, p_mode
      ) b
    ) else '[]'::jsonb end,
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board_scoped(p_since - 7, 1, null, p_since - 1, p_mode) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    'lastMonth', case when coalesce(p_open, false) and p_month_since is not null then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board_scoped(p_month_since, 1, null, p_month_until, p_mode) b
      where b.rank = 1
    ), 'null'::jsonb) else 'null'::jsonb end,
    'words', case when p_words_before is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      from public.leaderboard_words(p_words_before, p_words_since, 12) w
    ) end
  );
$$;

revoke all on function public.leaderboard_boards_scoped(
  date, integer, boolean, date, date, uuid, date, date, date, date, text
) from public, anon, authenticated;
grant execute on function public.leaderboard_boards_scoped(
  date, integer, boolean, date, date, uuid, date, date, date, date, text
) to service_role;

/*
 * The unscoped board, redefined as Standard's.
 *
 * Same signature, so this replaces rather than overloads and nothing in flight
 * breaks. What changes is what it means: without a mode filter it would now sum
 * a player's Standard and Freeform days into one number, which is the exact
 * ranking the split exists to prevent -- and its callers (the public read
 * wrapper in 20260911060000, which anon calls, and the Reddit build's merged
 * board) are all asking for "the board", which from today is Standard's.
 *
 * The trial week's rows leave it with this change. That is the honest answer:
 * those days were played without the fold, and a board that keeps ranking them
 * beside folded ones is the thing that was wrong -- they are still counted, on
 * the Freeform board, where they were earned.
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
  select b.rank, b.player_id, b.window_word, b.window_zipf, b.total_score, b.puzzles
  from public.leaderboard_board_scoped(p_since, p_limit, p_player, p_until, 'standard') b
  order by b.rank;
$$;

revoke all on function public.leaderboard_board(date, integer, uuid, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date) to service_role;
