-- A read-only door onto the live check's verdicts, for the Reddit build.
--
-- The website's fallback asks Merriam-Webster whether a word its offline
-- dictionary rejected is nonetheless real, and records the answer in
-- word_sightings. Those keys are free non-commercial ones, capped at 1,000
-- requests per reference per day for the whole game -- an allowance a Reddit
-- audience would exhaust, and one whose licence was never written with a second
-- deployment in mind.
--
-- So the Reddit build does not call Merriam-Webster at all. It reads the
-- verdicts this site has already collected, through the function below. A word
-- the website has judged is simply known there; a word it has not is unknown,
-- and the game's original rejection stands. Over time the site's own play keeps
-- filling the table, and the Reddit build gets the benefit without ever holding
-- a key or spending a request.
--
-- Nothing here is written from Reddit. The verdicts flow one way.
--
-- The table comment says the game never reads this table. That was true of the
-- browser and stays true of it: what reads is a server, for a deployment that
-- has no other way to ask, and only through this function.

/*
 * One word's verdict, or no row when the live check has never judged it.
 *
 * Returns the columns api/validate.ts answers with, under the names it uses, so
 * the Reddit build can hand the row to the same client that parses the
 * website's live check. Deliberately not the whole row: lookups, first_seen_at,
 * last_seen_at and status are this project's own bookkeeping and say nothing
 * about the word.
 *
 * `security definer` to read past RLS, which stays on with no policies so anon
 * still cannot touch the table directly. `search_path` is pinned so a caller
 * cannot put a table of their own in front of `public`.
 */
create or replace function public.word_verdict(p_word text)
returns table (
  word text,
  outcome text,
  reason text,
  zipf numeric,
  pos text[],
  first_use text,
  source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.word, s.outcome, s.reason, s.zipf, s.pos, s.first_use, s.source
  from public.word_sightings s
  -- The same rule the game's own input uses. A pattern this tight means the
  -- argument cannot be anything but a word, whatever a caller sends.
  where s.word = lower(p_word)
    and lower(p_word) ~ '^[a-z]{2,30}$'
  limit 1;
$$;

comment on function public.word_verdict(text) is
  'One word''s live-check verdict, for the Reddit build to read instead of calling Merriam-Webster. Callable by anon.';

-- Revoked from PUBLIC and granted back explicitly: a revoke from PUBLIC takes
-- the grant from every role that only ever inherited it, service_role included.
revoke all on function public.word_verdict(text) from public, anon, authenticated;
grant execute on function public.word_verdict(text) to anon, service_role;
