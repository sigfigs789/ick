/*
 * Record which mode each find was made in.
 *
 * From MODE_CHOICE_START (2026-09-27) Freeform accepts obsolete, archaic and
 * dated words that Standard refuses, and both modes' finds share one feed. The
 * client hides from a Standard reader any find Standard would refuse, but it can
 * only judge a word its own lists know. A word only Merriam-Webster has judged
 * -- archaic to MW, absent from the curated list, the metadata and the corpus --
 * looks the same offline whether it plays in Standard or not. What does tell
 * them apart is whether anybody found it *in* Standard, which is what this
 * column records and `leaderboard_words` now reports.
 *
 * Three changes:
 *   - `leaderboard_finds.mode`, 'standard' or 'freeform'. Existing rows are
 *     Standard except the trial week (2026-09-14 through 2026-09-26), which
 *     everybody played in Freeform by the calendar.
 *   - `submit_leaderboard_scores` writes it from each day's `mode` (absent means
 *     Standard), and upgrades a Freeform find to Standard when the same player
 *     banks the word in Standard as well. Otherwise identical to the
 *     20260923000000 definition it replaces.
 *   - `leaderboard_words` returns `standard`: whether any finder banked the word
 *     in Standard. Dropped and recreated, because the return type changes.
 *
 * Safe in either order against the client and API. The previous submit
 * function ignores `mode`, so finds land as Standard; the previous API ignores
 * the new column, and the new one reads a missing `standard` as true.
 */

alter table public.leaderboard_finds
  add column if not exists mode text not null default 'standard'
  check (mode in ('standard', 'freeform'));

comment on column public.leaderboard_finds.mode is
  'Which rules the find was banked under. Standard wins when a player banks the word in both.';

update public.leaderboard_finds
  set mode = 'freeform'
  where puzzle_date between date '2026-09-14' and date '2026-09-26'
    and mode = 'standard';

-- The upgrade in submit_leaderboard_scores is the first write that updates a
-- find, and it touches this one column. Granted explicitly, like everything
-- else service_role uses: its rights do not come from PUBLIC.
grant update (mode) on public.leaderboard_finds to service_role;

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
      -- Absent reads as false, which is what every submission sent before this
      -- column existed meant and what a backfilled day without a retry means.
      coalesce((s ->> 'retried')::boolean, false) as retried,
      -- A day played in Freeform by choice. Absent reads as false, which is what
      -- every submission sent before the flag existed meant.
      coalesce((s ->> 'unranked')::boolean, false) as unranked,
      -- Which rules the day was played under. Absent reads as Standard, which is
      -- what every submission sent before the field existed meant outside the
      -- trial week (the trial's rows are backfilled above).
      case when s ->> 'mode' = 'freeform' then 'freeform' else 'standard' end as mode,
      s -> 'found' as found
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per date before the insert sees it: a batch could name the same day
  -- twice, and ON CONFLICT cannot resolve a conflict against a row the same
  -- statement is still inserting. Ranked rather than max()'d per column, so the
  -- day's word and its numbers come from the same entry -- and the post-retry
  -- entry outranks a pre-retry one whatever the two scores are, because it is
  -- the newer account of the day rather than the better one.
  deduped as (
    select distinct on (puzzle_date)
      puzzle_date, top_word, top_zipf, total_score, top_score, words, retried
    from incoming
    -- Freeform days go no further than the finds below.
    where not unranked
    order by puzzle_date, retried desc, total_score desc, top_zipf asc
  ),
  -- Written before the scores so a failure here cannot leave a day ranked with
  -- no words behind it. Unchanged by retraction: a word a player took back is
  -- still a word they found, and the feed goes on saying so.
  --
  -- One row per word per day even when a batch carries the day in both modes,
  -- and the Standard one wins: a Standard find is the stronger claim, since it
  -- says the word plays under the stricter rules.
  finds as (
    select distinct on (i.puzzle_date, (f ->> 'word'))
      i.puzzle_date,
      (f ->> 'word')::text as word,
      (f ->> 'zipf')::numeric as zipf,
      i.mode
    from incoming i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.found) = 'array' then i.found else '[]'::jsonb end
    ) as f
    order by i.puzzle_date, (f ->> 'word'), (i.mode = 'standard') desc,
      (f ->> 'zipf')::numeric asc
  ),
  -- A repeat is still discarded, with one exception: a word this player first
  -- banked in Freeform and has now banked in Standard too is upgraded to
  -- Standard. Nothing else on the row moves -- `found_at` in particular stays
  -- the first sighting, which is what the feed orders on.
  found_written as (
    insert into public.leaderboard_finds (player_id, puzzle_date, word, zipf, mode)
    select p_player_id, f.puzzle_date, f.word, f.zipf, f.mode
    from finds f
    on conflict (player_id, puzzle_date, word) do update set mode = 'standard'
      where public.leaderboard_finds.mode = 'freeform' and excluded.mode = 'standard'
    returning 1
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, top_word, top_zipf, total_score, top_score, words, retried)
    select p_player_id, d.puzzle_date, d.top_word, d.top_zipf,
           d.total_score, d.top_score, d.words, d.retried
    from deduped d
    on conflict (player_id, puzzle_date) do update set
      -- The first submission since the retry is assigned rather than maxed: it
      -- is the only thing in this game that can make a day smaller, and it is
      -- allowed to because the player asked for it. Every other case is the
      -- monotonic rule this table has always had.
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
      -- The word follows the score it came with: replaced when this submission
      -- is the one raising the day, and also when it is the one correcting it,
      -- so the word on the row is always the word that earned the number on it.
      top_word = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_word else public.leaderboard_scores.top_word end,
      top_zipf = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_zipf else public.leaderboard_scores.top_zipf end,
      -- Latches. A day that has spent its retry has spent it for good, and this
      -- is what makes the stale case below decidable.
      retried = public.leaderboard_scores.retried or excluded.retried,
      updated_at = now()
    -- A submission that predates the retry, arriving after it. It is not merely
    -- a smaller number than the row -- it is an account of a day that no longer
    -- exists, and maxing it back in is exactly the inflation this migration is
    -- here to remove.
    where excluded.retried or not public.leaderboard_scores.retried
    returning 1
  )
  -- Days, not words: this is what the endpoint echoes back as `days`, and the
  -- finds are a side effect of submitting a day rather than something a caller
  -- asked for. `found_written` goes unread on purpose and still runs -- Postgres
  -- executes a data-modifying CTE exactly once and to completion whether or not
  -- the primary query reads its output.
  --
  -- Counts rows the upsert actually wrote, so a batch whose only day was a stale
  -- pre-retry straggler honestly reports nothing written.
  select count(*)::integer from written;
$$;

-- Granted explicitly rather than left to the previous definition's grants:
-- CREATE OR REPLACE keeps them, but a REVOKE-only migration that assumes
-- service_role inherits anything is working by luck. Say it outright.
revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_scores(uuid, jsonb) to service_role;


drop function if exists public.leaderboard_words(date, date, integer);

/*
 * The finds feed, as 20260831000000 defined it, plus `standard`: whether any
 * finder banked the word in Standard. A Standard reader is shown a word only if
 * somebody found it in Standard or Standard's own lists accept it (see
 * repriceFoundWords in src/game/leaderboard.ts).
 */
create function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 500
) returns table (
  word text,
  zipf numeric,
  finders integer,
  found_on date,
  standard boolean
)
language sql
stable
as $$
  select
    f.word,
    min(f.zipf) as zipf,
    count(distinct f.player_id)::integer as finders,
    max(f.puzzle_date) as found_on,
    bool_or(f.mode = 'standard') as standard
  from public.leaderboard_finds f
  where f.puzzle_date < p_before
    and f.puzzle_date >= p_since
  group by f.word
  order by max(f.found_at) desc, f.word asc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;
