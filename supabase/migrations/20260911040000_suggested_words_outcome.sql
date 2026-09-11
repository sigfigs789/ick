-- The word queue, now saying whether the game let the word be played on the spot.
--
-- `word_sightings.outcome` is the live Merriam-Webster verdict from the moment a
-- player typed the word into a puzzle, and it is a different fact from `status`:
--
--   outcome 'playable'  MW attested it mid-game, so the player played it there
--                       and then. Nobody judged it first -- the game approved it
--                       by itself, which is what "auto approved" means on the
--                       page.
--   outcome 'unknown'   MW had no entry; the rejection stood and the word was
--                       not played.
--   outcome 'suggested' the row exists because somebody typed the word into the
--                       suggestion box, not because anybody played it.
--
--   status              what a human decided afterwards: whether the word joins
--                       the curated dictionary everybody plays against.
--
-- The two disagree in both directions, which is the reason to show them side by
-- side: a word can be auto approved in a puzzle and later rejected from the
-- dictionary, and a word MW never attested can be accepted by hand.
--
-- Dropped and recreated rather than replaced: a function's output columns cannot
-- be changed in place, and this one grows `outcome`.
drop function if exists public.list_suggested_words(integer);

create or replace function public.list_suggested_words(p_limit integer default 200)
returns table (
  word text,
  origin text,
  zipf numeric,
  pos text[],
  first_use text,
  mw_source text,
  lookups integer,
  suggestions integer,
  first_at timestamptz,
  last_at timestamptz,
  outcome text
)
language sql
stable
as $$
  with asked as (
    select
      lower(e.props ->> 'word') as word,
      min(e.created_at) as first_suggested_at
    from public.analytics_events e
    where e.name = 'word_suggested'
      and e.props ? 'word'
      and lower(e.props ->> 'word') ~ '^[a-z]{2,30}$'
    group by 1
  )
  select
    v.word,
    v.origin,
    v.zipf,
    v.pos,
    v.first_use,
    v.mw_source,
    v.lookups::integer,
    v.suggestions::integer,
    least(
      coalesce(s.first_seen_at, 'infinity'::timestamptz),
      coalesce(a.first_suggested_at, 'infinity'::timestamptz)
    ) as first_at,
    v.last_at,
    -- Null for a word with no sighting at all: never played, only suggested.
    s.outcome
  from public.suggested_words v
  left join public.word_sightings s on s.word = v.word
  left join asked a on a.word = v.word
  -- Newest first, as of the 2026-09-11 ordering migration.
  order by least(
             coalesce(s.first_seen_at, 'infinity'::timestamptz),
             coalesce(a.first_suggested_at, 'infinity'::timestamptz)
           ) desc,
           v.word asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'Words waiting to be triaged into the curated dictionary, newest first, bounded, with the live MW verdict that let one be played. Read by api/review.ts.';

revoke all on function public.list_suggested_words(integer) from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
