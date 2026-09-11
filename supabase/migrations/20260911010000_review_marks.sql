-- A mark on a review row: accepted, rejected, or nothing yet.
--
-- The two review pages could be read and not answered. Reading a queue is half
-- of triaging it -- the other half is remembering which ones you have already
-- judged -- and without somewhere to put that, every pass over these lists
-- started from nothing.
--
-- Words already have the column for it: `word_sightings.status`, which is what
-- the graduation pass into the curated dictionary consumes and what
-- `set_word_status` writes (see the 2026-08-20 migration). A mark on the page is
-- that column, so the page and the dictionary pass agree by construction rather
-- than by being kept in step. Feedback has nothing of the kind and must not grow
-- one: `analytics_events` is an append-only mirror of what the client sent, and
-- a status column on it would be this app editing its own event log. So the
-- notes get a small table beside it, keyed by the event.

-- The mark on one note. Deleting the row is how a mark is cleared, so "no mark"
-- is the absence of a row rather than a third value to check for everywhere.
create table if not exists public.feedback_marks (
  -- The event the mark is about. Cascades, so a note that ever leaves the mirror
  -- does not leave a mark pointing at nothing.
  event_id bigint primary key
    references public.analytics_events (id) on delete cascade,
  mark text not null check (mark in ('accepted', 'rejected')),
  marked_at timestamptz not null default now()
);

comment on table public.feedback_marks is
  'Triage mark on one feedback note: accepted or rejected. No row means unmarked.';

alter table public.feedback_marks enable row level security;

-- RLS on with no policies denies every anon and authenticated request; the
-- service role bypasses it, and is granted explicitly because a REVOKE hands
-- nothing to anybody.
revoke all on public.feedback_marks from anon, authenticated;
grant select, insert, update, delete on public.feedback_marks to service_role;

-- Setting a mark, and clearing it: one function, because the page has one
-- control and it cycles through all three states.
--
-- A null or empty mark deletes the row. Anything else is checked by the table's
-- own constraint rather than re-checked here, so there is one definition of what
-- a mark can be.
--
-- Returns the mark that is now stored, null when it was cleared. A value rather
-- than void so the caller gets a body back and can say whether the toggle it
-- just drew is the state the database is in -- a write with nothing to check is
-- how a control ends up lying about what it saved.
create or replace function public.set_feedback_mark(p_event_id bigint, p_mark text)
returns text
language plpgsql
as $$
begin
  if p_mark is null or btrim(p_mark) = '' then
    delete from public.feedback_marks where event_id = p_event_id;
    return null;
  end if;
  insert into public.feedback_marks (event_id, mark, marked_at)
  values (p_event_id, p_mark, now())
  on conflict (event_id) do update set mark = excluded.mark, marked_at = now();
  return p_mark;
end;
$$;

revoke all on function public.set_feedback_mark(bigint, text) from public, anon, authenticated;
grant execute on function public.set_feedback_mark(bigint, text) to service_role;

-- The feedback list, now carrying whatever mark the note has.
--
-- Dropped and recreated rather than replaced: a function's output columns cannot
-- be changed in place, and this one grows `mark`.
drop function if exists public.list_feedback(integer);

create or replace function public.list_feedback(p_limit integer default 200)
returns table (
  id bigint,
  feedback text,
  created_at timestamptz,
  mark text
)
language sql
stable
as $$
  select
    e.id,
    e.props ->> 'feedback' as feedback,
    e.created_at,
    m.mark
  from public.analytics_events e
  left join public.feedback_marks m on m.event_id = e.id
  where e.name = 'feedback_submitted'
    and coalesce(btrim(e.props ->> 'feedback'), '') <> ''
  -- Oldest first: these are read as a sequence -- the same player often writes
  -- twice, and the second note answers the first.
  order by e.created_at asc, e.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_feedback(integer) is
  'Free-text feedback players have left with its triage mark, oldest first, bounded. Read by api/review.ts.';

revoke all on function public.list_feedback(integer) from public, anon, authenticated;
grant execute on function public.list_feedback(integer) to service_role;

-- The word queue, now carrying each word's status -- and no longer dropping a
-- word the moment it has one.
--
-- Which is the substantive change here. `suggested_words` is a queue in the
-- strict sense: a settled `status` takes a word out of it, so marking a word was
-- indistinguishable from losing it, and the page could show what was waiting but
-- never what had been decided. A mark you cannot see afterwards is not a record
-- of anything.
--
-- So this stops reading the view and rebuilds its membership from the two
-- tables, keeping every part of the view's rule except that one filter: a word
-- Merriam-Webster rejected or could not answer for is still no candidate, and a
-- word a player asked for is still a candidate with no verdict to judge. What
-- changes is that an accepted or rejected word stays on the list wearing its
-- mark.
--
-- `suggested_words` itself is untouched: the audit skills and the graduation
-- pass read it, and they want the strict queue.
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
  status text
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
    -- Where the candidate came from. 'both' is the strongest signal there is: a
    -- player asked for the word *and* reached for it in a puzzle.
    case
      when s.word is not null and a.word is not null then 'both'
      when s.word is not null then 'live-lookup'
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
    coalesce(s.status, 'new') as status
  from public.word_sightings s
  full outer join asked a on a.word = s.word
  -- A sighting qualifies only while Merriam-Webster approved it; a rejected or
  -- unanswered verdict is no candidate. Player-only suggestions have no verdict
  -- to judge, so they all show up.
  where s.word is null
     or s.outcome in ('playable', 'suggested')
  -- Oldest first, the expression repeated rather than the output column named: a
  -- name that is both an output column and a table column is a fight not worth
  -- having.
  order by least(s.first_seen_at, a.first_suggested_at) asc,
           coalesce(s.word, a.word) asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'Candidate words with their triage status, oldest submission first, bounded. Read by api/review.ts.';

revoke all on function public.list_suggested_words(integer) from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
