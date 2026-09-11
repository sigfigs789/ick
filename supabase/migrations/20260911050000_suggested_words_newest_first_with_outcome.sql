-- The word queue: newest first, and saying which words the game let through by
-- itself.
--
-- Built on the definition the 2026-09-11 marks migration installed -- the one
-- that reads `word_sightings` and `asked` directly and returns `status` -- and
-- not on the older one that read the `suggested_words` view. That distinction
-- matters: the view keeps only untriaged rows, so a function built on it would
-- silently drop every word already accepted or rejected, and would not return
-- the mark the page draws.
--
-- Two changes, and nothing else moves.
--
-- 1. Newest first. Oldest first was a queue's order, and this was a queue nobody
--    but a curator could see. It is linked from the word rules sheet now, and
--    whoever follows that link is looking for the row they just created. The
--    bound follows the order: the limit keeps the most recent arrivals rather
--    than the oldest, so a queue past 200 rows stays current.
--
-- 2. `outcome` joins the output. It is the live Merriam-Webster verdict from the
--    moment the word was typed into a puzzle, and it is a different fact from
--    `status`:
--
--      'playable'   MW attested it mid-game, so the player played it there and
--                   then, with nobody judging it first.
--      'unknown'    somebody typed it into a puzzle and MW had no entry: tried,
--                   not played. (Such a row is filtered out below, as it always
--                   has been -- an unanswered verdict is no candidate.)
--      'suggested'  the row exists because the word was typed into the
--                   suggestion box. Nobody ever played it.
--
--    `status` is what a person decided afterwards, and the two disagree in both
--    directions: a word played on MW's say-so can still be kept out of the
--    dictionary, and a word MW never attested can be accepted by hand.
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
  status text,
  outcome text
)
language sql
stable
as $$
  with asked as (
    -- Player suggestions, counted and normalised. The regex is the game's own
    -- input rule, which is what keeps junk out of a list built from a free-text
    -- box.
    select
      lower(e.props ->> 'word') as word,
      count(*) as suggestions,
      min(e.created_at) as first_suggested_at,
      max(e.created_at) as last_suggested_at
    from public.analytics_events e
    where e.name = 'word_suggested'
      and e.props ? 'word'
      and lower(e.props ->> 'word') ~ '^[a-z]{2,30}$'
    group by 1
  )
  select
    coalesce(s.word, a.word) as word,
    -- Where the candidate came from, and what it means is narrower than it was.
    -- A sighting row is written for a suggestion too (outcome 'suggested'), so
    -- "there is a sighting" never meant "somebody played it" -- which is how
    -- trisymmetrical and absconce came to be labelled as played on a page where
    -- nobody had ever played them. Only a live verdict counts as a play now.
    case
      when s.outcome = 'playable' and a.word is not null then 'both'
      when s.outcome = 'playable' then 'live-lookup'
      else 'player'
    end as origin,
    s.zipf,
    coalesce(s.pos, '{}') as pos,
    s.first_use,
    s.source as mw_source,
    coalesce(s.lookups, 0)::integer as lookups,
    coalesce(a.suggestions, 0)::integer as suggestions,
    -- When the word arrived, by whichever door it came through first. `least`
    -- skips nulls, and a row exists only because one of the two sides does.
    least(s.first_seen_at, a.first_suggested_at) as first_at,
    greatest(s.last_seen_at, a.last_suggested_at) as last_at,
    -- A word with no sighting row has never been triaged, which is what 'new'
    -- means everywhere else.
    coalesce(s.status, 'new') as status,
    s.outcome
  from public.word_sightings s
  full outer join asked a on a.word = s.word
  -- A sighting qualifies only while Merriam-Webster approved it; a rejected or
  -- unanswered verdict is no candidate. Player-only suggestions have no verdict
  -- to judge, so they all show up.
  where s.word is null
     or s.outcome in ('playable', 'suggested')
  -- Newest first, the expression repeated rather than the output column named: a
  -- name that is both an output column and a table column is a fight not worth
  -- having.
  order by least(s.first_seen_at, a.first_suggested_at) desc,
           coalesce(s.word, a.word) asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'Candidate words with their triage status and live MW verdict, newest submission first, bounded. Read by api/review.ts.';

revoke all on function public.list_suggested_words(integer) from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
