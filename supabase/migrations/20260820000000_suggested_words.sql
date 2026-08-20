-- A single review queue for words worth adding to the curated dictionary.
--
-- Words arrive from two places, and until now they lived in two shapes: a live
-- Merriam-Webster approval lands in word_sightings, while a word a player typed
-- into the suggestion box lands as a `word_suggested` row in analytics_events.
-- This view puts both in one list so graduating words is a single query rather
-- than a join written from memory each time.
--
-- A view rather than a table on purpose: no new write path, nothing to keep in
-- sync, and a word drops out of the queue the moment its `status` changes.

create or replace view public.suggested_words
with (security_invoker = true) as
with player_suggestions as (
  -- Player suggestions carry no verdict, so they are counted and normalised
  -- here. The regex is the game's own input rule, which keeps junk out of the
  -- queue -- the suggestion box accepts free text.
  select
    lower(props ->> 'word') as word,
    count(*) as suggestions,
    min(created_at) as first_suggested_at,
    max(created_at) as last_suggested_at
  from public.analytics_events
  where name = 'word_suggested'
    and props ? 'word'
    and lower(props ->> 'word') ~ '^[a-z]{2,30}$'
  group by 1
)
select
  coalesce(s.word, p.word) as word,
  -- Where the candidate came from. 'both' is the strongest signal there is: a
  -- player asked for the word *and* reached for it in a puzzle.
  case
    when s.word is not null and p.word is not null then 'both'
    when s.word is not null then 'live-lookup'
    else 'player'
  end as origin,
  s.zipf,
  s.pos,
  s.first_use,
  s.source as mw_source,
  coalesce(s.lookups, 0) as lookups,
  coalesce(p.suggestions, 0) as suggestions,
  greatest(s.last_seen_at, p.last_suggested_at) as last_at
from public.word_sightings s
full outer join player_suggestions p on p.word = s.word
-- A word with a sighting qualifies only while Merriam-Webster approved it and
-- nobody has triaged it yet; a rejected verdict or a settled `status` takes it
-- out of the queue, whether or not a player also suggested it. Player-only
-- suggestions have no verdict to judge, so they all show up.
where s.word is null
   or (s.outcome in ('playable', 'suggested') and s.status = 'new')
-- Rarest first, then by how often the word keeps coming back. Unattested words
-- sort to the top: those are the ones that score a perfect 10, so they are worth
-- looking at before anything else.
order by s.zipf asc nulls first, coalesce(s.lookups, 0) + coalesce(p.suggestions, 0) desc;

comment on view public.suggested_words is
  'Review queue: words worth adding to the curated dictionary, from live MW approvals and player suggestions. Rarest first.';

revoke all on public.suggested_words from anon, authenticated;

-- A word can reach the queue as a player suggestion without ever being looked
-- up, so it has no verdict of its own. 'suggested' is that provenance: no
-- Merriam-Webster answer, the word arrived because someone asked for it. A real
-- lookup later overwrites it with the true verdict and leaves `status` alone.
alter table public.word_sightings
  drop constraint if exists word_sightings_outcome_check;
alter table public.word_sightings
  add constraint word_sightings_outcome_check
  check (outcome in ('playable', 'rejected', 'unknown', 'suggested'));

-- Graduating a batch: the one write the review pass needs. A word with no
-- sighting row gets one, so a player suggestion can be cleared from the queue
-- like anything else -- otherwise it would sit there forever with nothing to
-- mark. Returns how many words were settled.
create or replace function public.set_word_status(p_words text[], p_status text)
returns integer
language plpgsql
as $$
declare
  settled integer;
begin
  with wanted as (
    select distinct lower(word) as word
      from unnest(p_words) as word
     where lower(word) ~ '^[a-z]{2,30}$'
  ),
  upserted as (
    insert into public.word_sightings (word, outcome, status)
    select word, 'suggested', p_status from wanted
    on conflict (word) do update set status = p_status
    returning 1
  )
  select count(*) into settled from upserted;
  return settled;
end;
$$;

revoke all on function public.set_word_status(text[], text) from public, anon, authenticated;
