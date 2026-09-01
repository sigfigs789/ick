-- Today's finds orders on a word's *most recent* sighting, not its first.
--
-- The 2026-08-28 migration ordered the feed on `min(found_at)`: a word entered
-- where it first arrived and stayed there while its finder count climbed. The
-- reasoning was that a list should not reshuffle under the reader.
--
-- In practice that buries the thing the feed is for. The feed is a live signal
-- of what the day's players are turning up right now, and under `min` a word
-- five people are finding this minute sits motionless halfway down the day's
-- list. The most recent submission is the news, whether or not the word was new
-- to the feed, so a word somebody just found belongs at the top and takes its
-- incremented count up with it.
--
-- Ordered here rather than in the client because the ordering is the only place
-- this information exists. The rows the endpoint returns carry `word`, `zipf`,
-- `finders` and `found_on` -- and `found_on` is the puzzle date, the same value
-- on every row. Nothing in the payload says *when* a word was found, so the
-- sequence the rows arrive in is the whole of it. A client can diff finder
-- counts between two polls and hoist what moved, which works for a page left
-- open and not at all for a page just opened; a fresh load has nothing to diff
-- against and would show first-sighting order, which is the case this is for.
--
-- The reshuffling that worried the earlier version is bounded by what can move a
-- row: `found_at` is set once per player per word and never updated (the
-- `do nothing` in submit_leaderboard_scores), so a player re-sending their whole
-- running word list -- which happens after every accepted word -- moves nothing.
-- Only a player who has not found this word before can lift it, which is exactly
-- the event worth showing.
--
-- Everything else about the function is unchanged, and the signature is
-- identical so this replaces rather than overloads.
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
  order by max(f.found_at) desc, f.word asc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

-- Granted explicitly rather than left to the earlier migration's grant: a fresh
-- database replaying these in order gets the grant from 2026-08-28 and keeps it
-- through CREATE OR REPLACE, but saying it here means this file stands alone.
revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;
