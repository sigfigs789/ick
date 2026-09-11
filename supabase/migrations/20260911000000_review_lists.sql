-- Two read functions behind the review pages: the word queue, and the feedback
-- players have typed.
--
-- Both lists already exist -- `suggested_words` is a view (2026-08-20), and
-- feedback is a `feedback_submitted` row in `analytics_events` -- and both were
-- reachable only from a psql prompt holding the service-role key. These two
-- functions are what lets an edge function read them instead, so the lists can
-- be looked at from a browser (see api/review.ts).
--
-- Functions rather than PostgREST table reads, for the reason api/_supabase.ts
-- gives: the shape of a read stays fixed on the server, and the only thing the
-- caller gets to choose is how many rows.

-- The review queue, in the order the words arrived.
--
-- Submission order rather than the view's own rarest-first: a queue is a queue,
-- and the word that has been waiting since August is the one that has been
-- waiting longest whatever its frequency turns out to be. Rarest-first is the
-- order you *judge* in once you are looking at the list, and it is a sort the
-- reader can do by eye -- the frequency is on every row.
--
-- Which means the list needs the one thing the view does not carry: when each
-- word first turned up. A word reaches the queue by two doors, so there are two
-- answers to that -- the first sighting of a live lookup, and the first time a
-- player typed it into the suggestion box -- and the earlier of them is when the
-- word arrived. `infinity` stands in for a door the word never came through, so
-- `least` picks the real one rather than collapsing to null.
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
  last_at timestamptz
)
language sql
stable
as $$
  with asked as (
    -- The same events the view counts, for their earliest timestamp rather than
    -- their number. The regex is the game's own input rule, which is what keeps
    -- junk out of a list built from a free-text box.
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
    v.last_at
  from public.suggested_words v
  left join public.word_sightings s on s.word = v.word
  left join asked a on a.word = v.word
  -- Oldest first, and the expression repeated rather than the output column
  -- named: a name that is both an output column and a table column is a fight
  -- not worth having.
  order by least(
             coalesce(s.first_seen_at, 'infinity'::timestamptz),
             coalesce(a.first_suggested_at, 'infinity'::timestamptz)
           ) asc,
           v.word asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'The suggested_words review queue, oldest submission first, bounded. Read by api/review.ts.';

-- Free-text feedback, in the order it was submitted.
--
-- The event carries nothing but the note: no player id, no name, nothing about
-- the person (see src/analytics.ts, trackFeedback). What comes back is the text
-- and when the server received it, which is the whole of what was stored.
--
-- Blank notes are dropped rather than returned as empty rows: the form will not
-- submit one, so a row with nothing in it is noise from some older shape of the
-- event and not a piece of feedback anybody left.
create or replace function public.list_feedback(p_limit integer default 200)
returns table (
  id bigint,
  feedback text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    e.id,
    e.props ->> 'feedback' as feedback,
    e.created_at
  from public.analytics_events e
  where e.name = 'feedback_submitted'
    and coalesce(btrim(e.props ->> 'feedback'), '') <> ''
  -- Oldest first: these are read as a sequence -- the same player often writes
  -- twice, and the second note answers the first.
  order by e.created_at asc, e.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_feedback(integer) is
  'Free-text feedback players have left, oldest first, bounded. Read by api/review.ts.';

-- Granted to service_role explicitly rather than left to the revoke: a REVOKE
-- hands nothing to anybody, and these signatures are new.
revoke all on function public.list_suggested_words(integer)
  from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
revoke all on function public.list_feedback(integer)
  from public, anon, authenticated;
grant execute on function public.list_feedback(integer) to service_role;
