-- Two boards: one for Standard, one for Freeform.
--
-- Freeform used to be a way to play rather than a way to compete -- you got your
-- score, you could share it, and nothing left the browser. That was the honest
-- answer while there was one board: the two modes do not produce comparable
-- numbers (Freeform prices every word on its own frequency and hands out a
-- Legend where Standard folds the word onto its common form), so one board
-- holding both would have ranked whoever had the switch on.
--
-- The answer to that is two boards, not one board and a locked door. Each mode
-- ranks its own players against each other, which is the comparison that was
-- fair all along, and nobody has to choose between the rules they enjoy and
-- being on a list.
--
-- The split starts where the *choice* starts, on MODE_CHOICE_START
-- (src/game/mode.ts). Everything before it is written 'shared' and counts on
-- both boards. Those days were played before there was a choice to make -- the
-- trial week ran Freeform for everybody at once, and everything before it ran
-- Standard for everybody at once -- so each of them already ranked everyone who
-- played it, fairly. Splitting them retroactively would not produce two fair
-- boards out of one; it would halve one and delete the other's history. So the
-- split governs new scoring only, and a player's September does not shrink
-- because they moved the switch on the 27th.
--
-- The visible consequence, stated rather than discovered: a monthly board
-- straddling the split counts its pre-split days on both of its versions. That
-- is one month, September 2026, and never again. The weekly and daily boards
-- never straddle it, because MODE_CHOICE_START is a Sunday.
--
-- `leaderboard_finds` is deliberately untouched -- no mode column, no filter.
-- The finds feed is a record of what the day's players turned up, and a word is
-- a word whichever rules the finder was playing under. Splitting it would halve
-- the one part of this page that reads as live, to enforce a distinction its
-- readers are not making. The feed's *scores* are Standard's for everybody,
-- which the client already decides (see `parseWords` in game/leaderboard.ts):
-- the rows here carry a word and a frequency and no score at all, so pricing
-- has never been this table's business.
--
-- Every function below is dropped and recreated rather than replaced, because
-- each grows a parameter and a differing argument list makes a second overload
-- rather than a replacement -- which would leave PostgREST two candidates to
-- choose between. The cost is the usual one: requests in flight during the
-- migration fail. See 20260829000000, which made the same trade.

-- Which board a day's score belongs on. 'shared' is a day from before the split,
-- which belongs on every board; the other two are a day played under that mode.
--
-- Defaulted to 'shared' rather than to 'standard', which is what makes this
-- migration a no-op for every row already written: they all predate the choice,
-- so they all belong on both boards, and none of them has to be touched.
alter table public.leaderboard_scores
  add column if not exists mode text not null default 'shared'
  check (mode in ('shared', 'standard', 'freeform'));

comment on column public.leaderboard_scores.mode is
  'Which board this day counts on: standard, freeform, or shared (played before the modes split, counts on both).';

-- One score per player per puzzle *per board*. A player may play the same puzzle
-- both ways from the split on -- the game keeps a full set of guesses for each
-- (src/game/storage.ts) -- and each of those is a real day's play that belongs
-- on its own board. Before the split there is one row per day as there always
-- was, because there was one way to play it.
alter table public.leaderboard_scores
  drop constraint if exists leaderboard_scores_pkey;
alter table public.leaderboard_scores
  add primary key (player_id, puzzle_date, mode);

/*
 * The first puzzle whose score belongs to one board rather than to both.
 *
 * MODE_CHOICE_START in src/game/mode.ts, which is the one place the client
 * states it. Two homes for one constant is a constant that eventually disagrees
 * with itself, and there is no way around it here -- the client cannot be asked
 * at write time and the database cannot import a TypeScript module. What this
 * buys is that the *derivation* has one home: the client says which mode it
 * played in and this function decides whether that answer matters, so a client
 * that lies about a pre-split day cannot put it on one board only.
 *
 * Immutable because it is a literal. If the choice date ever moves, this moves
 * with it in the same migration, and any rows already written past the old date
 * need their mode rewritten -- there were none when this shipped.
 */
create or replace function public.leaderboard_mode_split() returns date
language sql
immutable
as $$ select date '2026-09-27' $$;

revoke all on function public.leaderboard_mode_split() from public, anon, authenticated;
grant execute on function public.leaderboard_mode_split() to service_role;

/*
 * Submit a player's scores -- one puzzle, or a whole history at once.
 *
 * Grows one field per score, `mode`, and one rule about it: it is honoured only
 * for a day on or after the split, and every day before that is written 'shared'
 * whatever the client said. The client has no business deciding that a July
 * puzzle belongs to one board, and this is the only writer, so saying it here
 * makes it true of the table rather than true of a promise.
 *
 * An absent mode reads as 'standard', which is what every submission sent before
 * this column existed meant and what the default mode is for a player who has
 * never touched the switch.
 *
 * Everything else is unchanged: the monotonic write, the retry's one exception,
 * and the finds insert that runs beside it. See 20260831010000 for the four
 * retry cases, which now play out per board -- a retry spent in Standard says
 * nothing about the Freeform row beside it, which is right, because they are
 * two different days of play with a retry each.
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
      (s ->> 'word')::text as top_word,
      (s ->> 'zipf')::numeric as top_zipf,
      (s ->> 'total')::numeric as total_score,
      (s ->> 'top')::numeric as top_score,
      (s ->> 'words')::smallint as words,
      coalesce((s ->> 'retried')::boolean, false) as retried,
      -- Derived, not trusted. A day before the split is 'shared' however it was
      -- labelled, and a day after it is the mode it was played in -- bounded to
      -- the two real ones, so an unrecognised label reads as Standard rather
      -- than writing a row no board will ever select.
      case
        when (s ->> 'date')::date < public.leaderboard_mode_split() then 'shared'
        when (s ->> 'mode') = 'freeform' then 'freeform'
        else 'standard'
      end as mode,
      s -> 'found' as found
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per day *and board* before the insert sees it: a batch carries both
  -- modes of the same puzzle from a browser that played it both ways, and those
  -- are two rows rather than a conflict to resolve. Within one board the rule is
  -- what it was -- the post-retry entry outranks a pre-retry one whatever the
  -- two scores are, because it is the newer account of the day rather than the
  -- better one.
  deduped as (
    select distinct on (puzzle_date, mode)
      puzzle_date, mode, top_word, top_zipf, total_score, top_score, words, retried
    from incoming
    order by puzzle_date, mode, retried desc, total_score desc, top_zipf asc
  ),
  -- The feed, which has no modes: a word is a word whichever rules the finder
  -- was playing under, and this table has never carried a score to disagree
  -- about. Deduped across modes as well as within one, so a player who found the
  -- same word both ways writes it once -- which is already what the primary key
  -- says, and saying it here means the row that lands is chosen rather than
  -- whichever the planner reached first.
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
 * One board over a window, for one mode.
 *
 * `p_mode` names which board: rows played in that mode, plus every 'shared' row,
 * which is the whole of the pre-split rule. An omitted or unrecognised mode
 * reads as Standard, which is the right legacy answer -- it is the board that
 * existed before this migration and the one an outside caller that has never
 * heard of modes means.
 *
 * Because a player holds at most one row per day per board, the group-by below
 * counts exactly what it counted before: one day, once.
 *
 * Everything else -- the ranking, the tie-breaks, the window word, the
 * hundredths, the row returned from below the cut -- is unchanged from
 * 20260916010000.
 */
drop function if exists public.leaderboard_board(date, integer, uuid, date);

create function public.leaderboard_board(
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
    where (p_since is null or s.puzzle_date >= p_since)
      and (p_until is null or s.puzzle_date <= p_until)
      -- This board's own days, and the days that belong to every board.
      and s.mode in (
        'shared',
        case when p_mode = 'freeform' then 'freeform' else 'standard' end
      )
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

revoke all on function public.leaderboard_board(date, integer, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.leaderboard_board(date, integer, uuid, date, text) to service_role;

-- The board's scan now filters on mode as well as on date. Leading with the
-- date keeps every window query using it exactly as before; the second column
-- takes the mode filter off the rows it fetches rather than out of the heap.
drop index if exists public.leaderboard_scores_date_idx;
create index if not exists leaderboard_scores_date_mode_idx
  on public.leaderboard_scores (puzzle_date desc, mode);

/*
 * Both boards and the finds, for one mode.
 *
 * `p_mode` passes straight through to every board call and nowhere near the
 * finds, which are the same list for everybody (see the header). That includes
 * the two champion rows: a champion is a board row, so there is one per board,
 * and last week's Freeform winner is a different person from last week's
 * Standard winner.
 *
 * Otherwise unchanged from 20260830000000.
 */
drop function if exists public.leaderboard_boards(date, integer, boolean, date, date, uuid, date, date, date, date);

create function public.leaderboard_boards(
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
      from public.leaderboard_board(p_since, p_limit, p_player, p_week_until, p_mode) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_season_since, p_limit, p_player, p_season_until, p_mode) b
    ) else '[]'::jsonb end,
    -- The week before the one above it, closed and final, on this board.
    'lastWeek', case when coalesce(p_open, false) then coalesce((
      select to_jsonb(b)
      from public.leaderboard_board(p_since - 7, 1, null, p_since - 1, p_mode) b
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

/*
 * One board over a window, for an outside reader.
 *
 * Standard by default, which is what the Reddit build means: its own board holds
 * players of the folding game, and merging Freeform scores into it would be the
 * mixed board this migration exists to avoid. The parameter is offered anyway,
 * so a caller that wants the other one can say so.
 *
 * Still a thin wrapper rather than a second copy of the query: the ranking, the
 * tie-breaks, the window word and now the mode filter are decided in exactly one
 * place. See 20260911060000 for why `security definer` and the pinned
 * `search_path` are load-bearing here.
 */
drop function if exists public.leaderboard_public_board(date, integer);

create function public.leaderboard_public_board(
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
  select * from public.leaderboard_board(
    p_since, least(greatest(coalesce(p_limit, 200), 1), 200), null, null, p_mode
  );
$$;

comment on function public.leaderboard_public_board(date, integer, text) is
  'Read-only board for the Reddit build to import, Standard by default. Callable by anon; returns only the aggregate the leaderboard page already shows.';

revoke all on function public.leaderboard_public_board(date, integer, text)
  from public, anon, authenticated;
grant execute on function public.leaderboard_public_board(date, integer, text) to anon, service_role;
