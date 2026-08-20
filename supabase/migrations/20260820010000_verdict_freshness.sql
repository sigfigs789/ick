-- Separate "when we last answered for this word" from "when the verdict itself
-- was fetched", so word_sightings can serve as a read-through cache in front of
-- Merriam-Webster without the cache refreshing its own freshness.
--
-- Without this, a cache hit that bumped last_seen_at would keep pushing the
-- row's expiry out and a stored verdict would never be re-checked. verdict_at
-- moves only when an upstream actually answered.

alter table public.word_sightings
  add column if not exists verdict_at timestamptz not null default now();

comment on column public.word_sightings.verdict_at is
  'When an upstream (MW/Datamuse) last produced this verdict. Cache freshness is measured from here, never from last_seen_at.';

-- Serving a word from the cache is still a sighting: the counters and
-- last_seen_at move, the verdict and its age do not.
create or replace function public.record_word_hit(p_word text)
returns void
language sql
as $$
  update public.word_sightings
     set lookups = lookups + 1,
         last_seen_at = now()
   where word = p_word;
$$;

revoke all on function public.record_word_hit(text) from public, anon, authenticated;

-- Same as before, plus verdict_at: this path only runs when an upstream answered.
create or replace function public.record_word_sighting(
  p_word text,
  p_outcome text,
  p_reason text default null,
  p_zipf numeric default null,
  p_pos text[] default '{}',
  p_first_use text default null,
  p_source text default null
) returns void
language sql
as $$
  insert into public.word_sightings
    (word, outcome, reason, zipf, pos, first_use, source, verdict_at)
  values
    (p_word, p_outcome, p_reason, p_zipf, coalesce(p_pos, '{}'), p_first_use, p_source, now())
  on conflict (word) do update set
    outcome = excluded.outcome,
    reason = excluded.reason,
    zipf = excluded.zipf,
    pos = excluded.pos,
    first_use = excluded.first_use,
    source = excluded.source,
    verdict_at = now(),
    lookups = public.word_sightings.lookups + 1,
    last_seen_at = now();
$$;

-- The cache lookup: one row by primary key, so no new index is needed.
