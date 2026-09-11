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

-- The review queue, newest activity first within the rarity order the view
-- already imposes. The view's own ORDER BY is not trusted to survive being
-- selected from, so it is restated here.
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
  last_at timestamptz
)
language sql
stable
as $$
  select
    s.word,
    s.origin,
    s.zipf,
    s.pos,
    s.first_use,
    s.mw_source,
    s.lookups::integer,
    s.suggestions::integer,
    s.last_at
  from public.suggested_words s
  -- Rarest first, then by how often the word keeps coming back: the same order
  -- the view documents, because it is the order a triage pass wants.
  order by s.zipf asc nulls first,
           coalesce(s.lookups, 0) + coalesce(s.suggestions, 0) desc,
           s.word asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'The suggested_words review queue, rarest first, bounded. Read by api/review.ts.';

-- Free-text feedback, newest first.
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
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_feedback(integer) is
  'Free-text feedback players have left, newest first, bounded. Read by api/review.ts.';

-- Granted to service_role explicitly rather than left to the revoke: a REVOKE
-- hands nothing to anybody, and these signatures are new.
revoke all on function public.list_suggested_words(integer)
  from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
revoke all on function public.list_feedback(integer)
  from public, anon, authenticated;
grant execute on function public.list_feedback(integer) to service_role;
