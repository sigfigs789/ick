-- The Freeform week verdict: the votes as people, and the notes left beside
-- them.
--
-- Two functions rather than one, because they answer two different questions
-- and only one of them can be collapsed. A vote is a tally -- how many players
-- came down on each side -- and a note is a thing somebody wrote, which is read
-- whole or not at all.
--
-- Both read `analytics_events`, the append-only mirror api/events.ts writes
-- (see src/analytics.ts, trackFreeformVote and trackFreeformFeedback). Nothing
-- here writes anything: this is the trial's scoreboard, and a scoreboard that
-- edits the log it counts is not one.

-- One row per voter: the verdict that player ended up on.
--
-- The latest vote per player rather than every tap, which is the whole reason
-- the vote carries a `voter` at all: a player who pressed Boooo, read the sheet
-- and pressed Love is one player who loves it, and counting taps would record
-- them as a tie. The sheet has always claimed this behaviour (see
-- components/FreeformModal.tsx); the id is what makes it true.
--
-- A vote with no voter at all is its own row, keyed on the event id. That is a
-- browser with storage off, or -- for the votes cast before the id was added to
-- the event -- a deployment that had not shipped it yet. Such a vote still
-- counts; it simply cannot be collapsed with another from the same person, and
-- assuming the reverse would be worse in both directions: dropped, it silently
-- loses real verdicts, and pooled under one null key, it flattens every
-- anonymous voter into a single vote.
--
-- The date carried is the date of the vote that counted, not of the first one:
-- what the tally wants to say is when this player made up their mind, and for
-- somebody who changed it that is the later tap.
create or replace function public.list_freeform_votes()
returns table (
  voter text,
  vote text,
  puzzle_date text,
  created_at timestamptz
)
language sql
stable
as $$
  select distinct on (coalesce(e.props ->> 'voter', 'event:' || e.id))
    coalesce(e.props ->> 'voter', 'event:' || e.id) as voter,
    e.props ->> 'vote' as vote,
    e.props ->> 'date' as puzzle_date,
    e.created_at
  from public.analytics_events e
  where e.name = 'freeform_vote'
    -- The two verdicts the sheet offers and nothing else: a row with any other
    -- value is a client and this function disagreeing, and it should not be
    -- quietly counted as one side of a trial.
    and e.props ->> 'vote' in ('love', 'boo')
  -- `distinct on` keeps the first row of each group, so the ordering is what
  -- picks the winner: newest per voter, with `id` breaking a same-second tie
  -- the same way it does everywhere else in this schema.
  order by 1, e.created_at desc, e.id desc;
$$;

comment on function public.list_freeform_votes() is
  'The Freeform week vote, one row per voter: their latest verdict and when they gave it. Read by api/review.ts.';

-- The notes left under the vote, newest first.
--
-- `vote` is the verdict the note was written beside, which is null whenever the
-- note came before the tap -- a note is often the reason somebody then votes,
-- and the sheet does not make them do it in either order. So it is filled in
-- from that player's actual verdict where the note itself has none: the point
-- of reading a note is to read it next to what the writer concluded, and
-- `latest` is the same per-voter collapse the tally above does.
--
-- `voter` stays inside the database. The page shows a note and a side, and has
-- no use for an id beyond the join that put the two together.
create or replace function public.list_freeform_feedback(p_limit integer default 200)
returns table (
  id bigint,
  feedback text,
  puzzle_date text,
  vote text,
  created_at timestamptz
)
language sql
stable
as $$
  with latest as (
    select voter, vote from public.list_freeform_votes()
  )
  select
    e.id,
    e.props ->> 'feedback' as feedback,
    e.props ->> 'date' as puzzle_date,
    coalesce(e.props ->> 'vote', l.vote) as vote,
    e.created_at
  from public.analytics_events e
  left join latest l on l.voter = e.props ->> 'voter'
  where e.name = 'freeform_feedback'
    and coalesce(btrim(e.props ->> 'feedback'), '') <> ''
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_freeform_feedback(integer) is
  'Free-text notes left under the Freeform week vote, newest first, bounded. Read by api/review.ts.';

-- Said out loud rather than left to the default, for the reason the feedback
-- migration gives: this database has been bitten by grants that were only ever
-- implicit, and service_role does not inherit what public is given.
revoke all on function public.list_freeform_votes() from public, anon, authenticated;
revoke all on function public.list_freeform_feedback(integer) from public, anon, authenticated;
grant execute on function public.list_freeform_votes() to service_role;
grant execute on function public.list_freeform_feedback(integer) to service_role;
