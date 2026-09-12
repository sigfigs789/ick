-- The feedback list, newest first.
--
-- It was oldest first, on the reasoning that notes are read as a sequence: the
-- same player often writes twice and the second note answers the first. That
-- was the right order for a curator working through a backlog nobody else could
-- see. The page is linked from the how-to-play sheet now, so the person opening
-- it is usually the person who just wrote a note, and what they came for is at
-- the bottom of the list. Newest first puts it where they are looking.
--
-- The bound changes meaning with the order, and for the better: the limit now
-- keeps the most recent notes rather than the oldest ones, so a list that has
-- outgrown it stays current instead of freezing on the first 200 ever written.
--
-- Replaced rather than dropped: the output columns are the same four, and only
-- the ordering inside the body moves.
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
  -- Newest first, and `id` breaks a tie the same way: two notes written in the
  -- same second come back with the later one on top.
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_feedback(integer) is
  'Free-text feedback players have left with its triage mark, newest first, bounded. Read by api/review.ts.';

-- Said again rather than assumed. A `create or replace` keeps the privileges the
-- function already had, but this database has been bitten by grants that were
-- only ever implicit, and one line here is cheaper than working out why a page
-- reads in production and not in a fresh restore.
revoke all on function public.list_feedback(integer) from public, anon, authenticated;
grant execute on function public.list_feedback(integer) to service_role;
