-- Today's finds becomes every word found on the puzzle, not one word per player.
--
-- The feed was built from `leaderboard_scores.top_word`, which holds a single
-- word per player per day -- their rarest. That made "Today's finds" a list of
-- personal bests rather than a list of finds, and it had a worse property than
-- being short: the column is *overwritten* when a player beats themselves, so a
-- word already on the feed would silently vanish the moment its only finder
-- found something rarer. A feed that removes things is not a feed.
--
-- So the words get their own table. One row per player per puzzle per word,
-- inserted once and never updated, which is what makes the feed's order
-- trustworthy: `found_at` is the moment a word first arrived and nothing
-- afterwards can move it.
--
-- `leaderboard_scores` is untouched. It still holds the day's rarest word, which
-- is what both boards rank and tie-break on; this table is only ever read by the
-- feed. Keeping them apart means the boards cannot be slowed or broken by a
-- table that grows five times as fast.

create table if not exists public.leaderboard_finds (
  -- The same anonymous, client-generated identity the scores table uses. Not a
  -- Supabase auth user; there is no auth in this game.
  player_id uuid not null,
  -- The puzzle the word was found on, as the player's own local calendar date.
  -- This is the whole key to the feed: a find belongs to a *puzzle*, not to a
  -- moment in UTC, because the drop is what makes the word mean anything.
  puzzle_date date not null,

  -- Constrained to a word rather than to a length, exactly as
  -- leaderboard_scores.top_word is: this column is written from an
  -- unauthenticated endpoint and displayed to other players, so a pattern this
  -- tight is what guarantees nothing expressible in it is invisible,
  -- right-to-left, or a passable imitation of the page's own copy.
  word text not null check (word ~ '^[a-z]{2,30}$'),
  -- Zipf runs roughly -2 (a word no corpus attests) to 8 ("the"); bounded wide.
  -- Stored so the client can price a word today's dictionary no longer carries.
  zipf numeric not null check (zipf >= -10 and zipf <= 10),

  -- When this player first submitted this word. Never updated -- see the
  -- `do nothing` in submit_leaderboard_scores -- so a word's place in the feed
  -- is fixed the moment it lands.
  found_at timestamptz not null default now(),

  -- One row per word per player per puzzle. A player re-submits their whole
  -- running word list after every accepted word, so the repeats are constant
  -- and this is what makes them free.
  primary key (player_id, puzzle_date, word)
);

comment on table public.leaderboard_finds is
  'Every word each anonymous player found, per puzzle date. Read by /api/leaderboard to build the Today''s finds feed.';

-- The feed's only query: one puzzle date, newest first. Covers the lookup and
-- the ordering, so the feed never scans a day it is not showing.
create index if not exists leaderboard_finds_puzzle_idx
  on public.leaderboard_finds (puzzle_date, found_at desc);

alter table public.leaderboard_finds enable row level security;
revoke all on public.leaderboard_finds from anon, authenticated;
-- Row-level security stays on with no policies, which denies `anon` and
-- `authenticated` outright; `service_role` bypasses RLS by design, and this
-- grant is what lets it through the privilege check first. Said out loud rather
-- than assumed: service_role's rights do not come from membership in PUBLIC.
grant select, insert on public.leaderboard_finds to service_role;

/*
 * Submit a player's scores, and the words that earned them.
 *
 * Same signature as before, so this replaces rather than overloads, and a client
 * that sends no `found` array keeps working exactly as it did -- which is what
 * the history backfill does, since a year of past words would blow the request
 * body and the feed only ever shows one day.
 *
 * The finds insert is `do nothing` rather than `do update`: a word's `found_at`
 * is the first time it arrived, and the whole point of the feed's ordering is
 * that nothing can move a row once it is placed. A player re-sends their entire
 * running word list after every accepted word, so all but the newest entry
 * conflicts every single time -- that is the design, not waste.
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
      s -> 'found' as found
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per date before the insert sees it: a batch could name the same day
  -- twice, and ON CONFLICT cannot resolve a conflict against a row the same
  -- statement is still inserting. Ranked rather than max()'d per column, so the
  -- day's word and its numbers come from the same entry.
  deduped as (
    select distinct on (puzzle_date)
      puzzle_date, top_word, top_zipf, total_score, top_score, words
    from incoming
    order by puzzle_date, total_score desc, top_zipf asc
  ),
  -- Every word in the batch, flattened and one row per day-and-word. Deduped
  -- here as well as by the primary key, for the same reason `deduped` exists: a
  -- batch could name the same day twice, and picking the row explicitly means
  -- the frequency stored for a word is chosen rather than whichever the planner
  -- happened to reach first. A missing or non-array `found` flattens to nothing,
  -- which is how the history backfill sends scores and no words.
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
  -- Written before the scores so a failure here cannot leave a day ranked with
  -- no words behind it. Both statements are in one transaction regardless; the
  -- order is for anybody reading an interrupted log.
  found_written as (
    insert into public.leaderboard_finds (player_id, puzzle_date, word, zipf)
    select p_player_id, f.puzzle_date, f.word, f.zipf
    from finds f
    on conflict (player_id, puzzle_date, word) do nothing
    returning 1
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, top_word, top_zipf, total_score, top_score, words)
    select p_player_id, d.puzzle_date, d.top_word, d.top_zipf,
           d.total_score, d.top_score, d.words
    from deduped d
    on conflict (player_id, puzzle_date) do update set
      total_score = greatest(public.leaderboard_scores.total_score, excluded.total_score),
      top_score = greatest(public.leaderboard_scores.top_score, excluded.top_score),
      words = greatest(public.leaderboard_scores.words, excluded.words),
      -- The word follows the score it came with: replaced only when this
      -- submission is the one raising the day, so the word on the row is always
      -- the word that earned the number on the row.
      top_word = case
        when excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_word else public.leaderboard_scores.top_word end,
      top_zipf = case
        when excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_zipf else public.leaderboard_scores.top_zipf end,
      updated_at = now()
    returning 1
  )
  -- Days, not words: this is what the endpoint echoes back as `days`, and the
  -- finds are a side effect of submitting a day rather than something a caller
  -- asked for. `found_written` goes unread on purpose and still runs -- Postgres
  -- executes a data-modifying CTE exactly once and to completion whether or not
  -- the primary query reads its output.
  select count(*)::integer from written;
$$;

revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_scores(uuid, jsonb) to service_role;

/*
 * Today's finds: every word found on one puzzle, newest first.
 *
 * Same argument list as the version it replaces, so this replaces rather than
 * overloads -- but it reads `leaderboard_finds` rather than the scores table, so
 * a word appears here because somebody found it, not because it was the best
 * thing they found.
 *
 * `p_since` / `p_before` still bracket the window, and the endpoint still passes
 * exactly one day: the puzzle the asking player is on. That is the only framing
 * that makes the list mean anything -- a find belongs to a drop, and `asphyxiate`
 * is just a word until you know the day asked for PHY.
 *
 * Ordered by the word's *first* sighting, descending. Deliberately `min` rather
 * than `max`: a word several people found should enter the feed once, where it
 * arrived, and stay there while its count goes up. Ordering on the most recent
 * sighting instead would have every popular word jump back to the top each time
 * somebody else found it, which is a list that reshuffles under the reader --
 * and it would make the arrival animation a lie, since the row it slid in at the
 * top of would already have been on screen further down.
 *
 * Alphabetical last so the order never wobbles between two identical calls.
 */
create or replace function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 500
) returns table (
  word text,
  zipf numeric,
  finders integer,
  found_on date
)
language sql
stable
as $$
  select
    f.word,
    -- One number for the word, not per finder. These are all the same value in
    -- practice -- the client sends today's measurement -- and min() is what makes
    -- that an assumption the query does not depend on.
    min(f.zipf) as zipf,
    count(distinct f.player_id)::integer as finders,
    max(f.puzzle_date) as found_on
  from public.leaderboard_finds f
  where f.puzzle_date < p_before
    and f.puzzle_date >= p_since
  group by f.word
  order by min(f.found_at) desc, f.word asc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;
