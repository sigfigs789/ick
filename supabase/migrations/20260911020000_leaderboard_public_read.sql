-- A read-only door onto the leaderboard, for the Reddit build to import through.
--
-- The Reddit app shows one board holding both games' players: its own, from
-- Reddit's Redis, and this site's, pulled in on a schedule and cached. Pulling
-- means reaching this database from outside Vercel, and the key that does it
-- lives in a Reddit app setting rather than an environment variable we control.
--
-- So it must not be the service-role key. That key bypasses row-level security
-- on every table here -- word_sightings, the review lists, the scores themselves
-- -- and it can write all of them. A leaked service key is the whole database;
-- a leaked anon key should be nothing at all.
--
-- Hence these two functions. RLS stays on with no policies, so `anon` still
-- cannot read a single row of any table directly. What `anon` gets is execute
-- on two `security definer` functions that return exactly the aggregate the
-- boards already publish -- no player rows, no per-player history, and nothing
-- that is not already visible to anybody who loads the leaderboard page.
--
-- `security definer` runs as the function's owner, which is what lets it read
-- past RLS. That makes `search_path` load-bearing: pinned here so a caller
-- cannot put a table of their own in front of `public` and have the body read
-- it instead.

/*
 * One board over a window, for an outside reader.
 *
 * A thin wrapper on `leaderboard_board` rather than a second copy of the query:
 * the ranking, the tie-breaks and the window word are decided in exactly one
 * place, and this function's whole job is to be the thing `anon` may call.
 */
create or replace function public.leaderboard_public_board(
  p_since date default null,
  p_limit integer default 200
) returns table (
  rank integer,
  player_id uuid,
  window_word text,
  window_zipf numeric,
  total_score numeric,
  puzzles integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Bounded harder than the internal function: an outside caller is importing a
  -- board to merge, not paging through the table.
  select * from public.leaderboard_board(p_since, least(greatest(coalesce(p_limit, 200), 1), 200));
$$;

comment on function public.leaderboard_public_board(date, integer) is
  'Read-only board for the Reddit build to import. Callable by anon; returns only the aggregate the leaderboard page already shows.';

/*
 * One puzzle's finds, for an outside reader.
 *
 * Same shape and the same spoiler rule as the page's own feed: the caller says
 * which puzzle, and gets the words found on it.
 */
create or replace function public.leaderboard_public_words(
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
security definer
set search_path = public, pg_temp
as $$
  select * from public.leaderboard_words(p_before, p_since, least(greatest(coalesce(p_limit, 500), 1), 500));
$$;

comment on function public.leaderboard_public_words(date, date, integer) is
  'Read-only finds feed for the Reddit build to import. Callable by anon.';

-- Revoking from PUBLIC is what actually locks a function down, and it is also
-- what takes it away from every role that only ever inherited it -- service_role
-- included. So both functions are revoked from everyone and then granted back to
-- exactly the roles that need them: anon, which is the Reddit app's reader, and
-- service_role, because this project has been bitten before by assuming it kept
-- a grant it only ever held through PUBLIC.
revoke all on function public.leaderboard_public_board(date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_public_board(date, integer) to anon, service_role;

revoke all on function public.leaderboard_public_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_public_words(date, date, integer) to anon, service_role;
