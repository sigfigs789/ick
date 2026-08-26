-- The finds feed stops being a top twelve, and stops riding on the boards.
--
-- Twelve rows was a sample of the day presented as the day. On a quiet day it is
-- everything that happened anyway; on a busy one it silently became a rolling
-- window, where a word could appear and be pushed off by newer finds without the
-- page ever saying so. A feed that drops things is worse than a short one,
-- because it looks complete either way.
--
-- So the cap goes to 500, which is a backstop rather than a limit: the rows are
-- distinct best-words-of-the-day, one per player per puzzle and then grouped, so
-- reaching 500 needs 500 players finding 500 different best words on the same
-- drop. Well past that point this is a scrolling wall and wants a different
-- design; until then the number the feed shows is the number there is. It is
-- kept as a cap at all so that a scripted flood cannot turn one open of the page
-- into a multi-megabyte response.
--
-- Only this function changes. `leaderboard_boards` keeps its `p_words_before` /
-- `p_words_since` parameters and its `words` key, both now unused: the endpoint
-- fetches this feed on its own so it can be cached across every player instead
-- of per player (see api/leaderboard.ts), and dropping the parameters would mean
-- dropping and recreating a function for no behavioural gain. They default to
-- null, which is already "send no words".
--
-- Same argument list, so this replaces rather than overloads.

create or replace function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 500
) returns table (
  word text,
  zipf numeric,
  finders integer,
  found_on date
)
language sql
stable
as $$
  select
    s.top_word as word,
    min(s.top_zipf) as zipf,
    count(distinct s.player_id)::integer as finders,
    max(s.puzzle_date) as found_on
  from public.leaderboard_scores s
  where s.puzzle_date < p_before
    and s.puzzle_date >= p_since
  group by s.top_word
  -- Newest first; alphabetical last so the order never wobbles between two
  -- identical calls.
  order by max(s.puzzle_date) desc, max(s.created_at) desc, s.top_word asc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

-- Re-issued rather than assumed. A replace keeps the privileges the function
-- already had, but service_role's execute is the one thing standing between the
-- endpoint and a 404 from PostgREST, and it does not come from membership in
-- public -- so it is said out loud here the same way it was said originally.
revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;
