-- WordInk word + event tracking.
--
-- Two write-only tables. Nothing in the game reads from them: the shipped
-- dictionary stays the only source of truth the browser consults, so the game
-- keeps working offline exactly as it does today. These tables exist so the
-- words players actually reach for -- and the events around them -- accumulate
-- somewhere queryable, ready to be folded into the curated list later.
--
-- Both tables are written only by the Vercel edge functions using the
-- service-role key. RLS is enabled with no policies at all, which denies every
-- anon and authenticated request; the service role bypasses RLS by design.

create table if not exists public.word_sightings (
  -- The lowercase word is the identity: one row per word, not per lookup.
  word text primary key,

  -- The live check's verdict, mirroring api/validate.ts's `outcome`:
  -- playable | rejected | unknown. Errors are never recorded -- a failed lookup
  -- says nothing about the word, and must not overwrite a real verdict.
  outcome text not null check (outcome in ('playable', 'rejected', 'unknown')),
  -- Why a word Merriam-Webster knows is still not playable: proper-noun,
  -- abbreviation, name-or-abbreviation, archaic, obsolete, offensive.
  reason text,

  -- Frequency Datamuse attested, on the same Zipf scale as rarity.json. Null
  -- means no source attested one, which is the game's unattested floor.
  zipf numeric,
  -- Merriam-Webster's functional labels (parts of speech) and first-known-use
  -- date, plus which reference answered: collegiate, medical, or both.
  pos text[] not null default '{}',
  first_use text,
  source text,

  -- Lookup counts are cache *misses*, not plays: /api/validate is CDN-cached for
  -- a day, so a word played a thousand times in one day is recorded once. Treat
  -- this as "seen again", never as popularity -- analytics_events has the real
  -- per-play counts.
  lookups integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Triage state for the future graduation pass into the curated dictionary.
  -- Nothing sets this yet; it is the column the review script will own.
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected', 'deferred'))
);

comment on table public.word_sightings is
  'One row per word the live Merriam-Webster fallback has judged. Write-only; the game never reads it.';

-- The graduation query this is all for: new playable words, rarest first.
create index if not exists word_sightings_triage_idx
  on public.word_sightings (status, outcome, last_seen_at desc);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  -- Event name as sent to Vercel Analytics, e.g. answer_accepted.
  name text not null,
  -- The event's properties verbatim. Flat, and validated by api/events.ts before
  -- it gets here: at most 32 keys of string, number, boolean or null.
  props jsonb not null default '{}'::jsonb,
  -- Server receipt time. The client's clock is never trusted or stored.
  created_at timestamptz not null default now()
);

comment on table public.analytics_events is
  'Mirror of the events sent to Vercel Analytics, kept so they can be queried with SQL and retained past the dashboard window.';

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (name, created_at desc);
-- The word carried by answer_accepted, answer_rejected, word_suggested and the
-- Merriam-Webster events, indexed so per-word history is cheap to pull.
create index if not exists analytics_events_word_idx
  on public.analytics_events ((props ->> 'word'))
  where props ? 'word';

alter table public.word_sightings enable row level security;
alter table public.analytics_events enable row level security;

-- Belt and braces: with no policies these grants are already inert, but PostgREST
-- should not so much as see the tables for the public roles.
revoke all on public.word_sightings from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;

-- Recording a sighting is an upsert that *increments* a counter, which PostgREST's
-- own upsert cannot express (it overwrites the columns it is given). Doing it as a
-- function keeps it one round trip from the edge and puts the merge rule in one
-- place: a fresh verdict replaces the stored one, the counters accumulate, and
-- `status` is never touched, so a word already triaged stays triaged.
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
  insert into public.word_sightings (word, outcome, reason, zipf, pos, first_use, source)
  values (p_word, p_outcome, p_reason, p_zipf, coalesce(p_pos, '{}'), p_first_use, p_source)
  on conflict (word) do update set
    outcome = excluded.outcome,
    reason = excluded.reason,
    zipf = excluded.zipf,
    pos = excluded.pos,
    first_use = excluded.first_use,
    source = excluded.source,
    lookups = public.word_sightings.lookups + 1,
    last_seen_at = now();
$$;

revoke all on function public.record_word_sighting(text, text, text, numeric, text[], text, text)
  from public, anon, authenticated;
