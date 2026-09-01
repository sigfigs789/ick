/*
 * Let a day get smaller, exactly once, when the player takes a word back.
 *
 * Each puzzle carries one retry: a banked word can be dropped and its guess
 * handed back (see src/game/storage.ts, retryWord). Everything the word earned
 * locally goes back with it -- but the board's write is monotonic per day
 * (`greatest(...)`, see the 20260825 migration), so the row kept the score the
 * player no longer holds. Nothing would ever lower it again short of them
 * beating it.
 *
 * The monotonic rule is not the bug, and is not being repealed. It is there so
 * that submissions arriving in whatever order the network delivers them cannot
 * undo each other: a late-arriving early submission, a re-sent backfill, and a
 * second browser on the same player id can all raise a day and none of them can
 * lower it. Every one of those reasons still holds.
 *
 * What was missing is a way for a client to say "this is a *newer* statement of
 * the day", as opposed to a better one. That normally means a revision counter
 * per day. Here it costs a single boolean, because the game allows exactly one
 * retry per puzzle: a day is either pre-retry or post-retry, that flag only ever
 * moves once and only ever in one direction, and the client has been persisting
 * it since the feature shipped (DailyProgress.retryUsed). So every submission
 * now carries `retried`, and the row remembers it:
 *
 *   retried=false onto retried=false  -- ordinary play. Monotonic, unchanged.
 *   retried=true  onto retried=false  -- the first word banked since the retry.
 *                                        Authoritative: assigned, not maxed, so
 *                                        the day can come down.
 *   retried=true  onto retried=true   -- ordinary play after the retry.
 *                                        Monotonic again; the day only grows
 *                                        from its corrected floor.
 *   retried=false onto retried=true   -- a pre-retry submission still in flight
 *                                        when the player took the word back.
 *                                        Stale: dropped entirely, which is what
 *                                        closes the race the flag exists for.
 *
 * The finds feed is deliberately untouched. `leaderboard_finds` is insert-only,
 * and a retracted word stays on it: the feed is a record of what players found,
 * and they did find it. Only the score the board ranks them on is corrected.
 *
 * One residual, stated rather than hidden: a player who retries their only word
 * and then never banks another leaves the pre-retry row standing, because a day
 * with no words is not submitted at all (see leaderboard.submitScore) and there
 * is nothing to carry the flag. It repairs itself the moment they play again --
 * that next word is the authoritative submission above -- so the window is one
 * abandoned puzzle, not a permanent wrong number.
 */

alter table public.leaderboard_scores
  add column if not exists retried boolean not null default false;

comment on column public.leaderboard_scores.retried is
  'Whether this day has spent its one retry. Only ever false -> true; a submission that disagrees is a pre-retry straggler and is dropped.';

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
    order by puzzle_date, retried desc, total_score desc, top_zipf asc
  ),
  -- Written before the scores so a failure here cannot leave a day ranked with
  -- no words behind it. Unchanged by retraction: a word a player took back is
  -- still a word they found, and the feed goes on saying so.
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
