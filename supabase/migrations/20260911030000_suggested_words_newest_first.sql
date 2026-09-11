-- The word queue, newest first -- the same move the feedback list just made, and
-- for the same reason.
--
-- Oldest first was a queue's order, and this was a queue nobody but a curator
-- could see. It is linked from the word rules sheet now, to whoever has just
-- suggested a word, and that person is looking for the newest row on the list:
-- their own. A word waiting since August is still waiting, and still on the
-- list; it is simply no longer the first thing a player is shown.
--
-- The bound follows the order, as it did for feedback: the limit now keeps the
-- most recent arrivals rather than the oldest, so a queue that outgrows 200 rows
-- stays current instead of freezing on its first 200 candidates.
--
-- `first_at` stays the date the ordering is built on -- when the word arrived,
-- by whichever door it came through -- so this reverses the sort and changes
-- nothing about what a row means.
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
  -- Newest first, and the expression repeated rather than the output column
  -- named, for the reason the original gave: a name that is both an output
  -- column and a table column is a fight not worth having.
  --
  -- `infinity` stands in for a door the word never came through, and it sorts
  -- first under `desc` where it sorted last under `asc`. It cannot arise here:
  -- a row is in `suggested_words` because it came through one door or the other,
  -- so `least` always has a real timestamp to pick.
  order by least(
             coalesce(s.first_seen_at, 'infinity'::timestamptz),
             coalesce(a.first_suggested_at, 'infinity'::timestamptz)
           ) desc,
           v.word asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_suggested_words(integer) is
  'Words waiting to be triaged into the curated dictionary, newest first, bounded. Read by api/review.ts.';

-- Said again rather than assumed, for the reason the feedback migration gives.
revoke all on function public.list_suggested_words(integer) from public, anon, authenticated;
grant execute on function public.list_suggested_words(integer) to service_role;
