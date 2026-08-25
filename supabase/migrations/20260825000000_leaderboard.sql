-- WordInk leaderboard: one score per player per puzzle, aggregated two ways.
--
-- This is the first table in this project the game *reads* from. Everything
-- else here (word_sightings, analytics_events) is write-only precisely so the
-- game keeps working offline; a leaderboard cannot be, because the whole point
-- is other people's scores. So the read path is contained: it lives behind
-- /api/leaderboard, it is CDN-cached, and every consumer treats a failure as
-- "no board today" rather than an error the player has to deal with. Nothing
-- about playing a puzzle depends on this table existing.
--
-- Identity is a client-generated UUID kept in localStorage plus a display name
-- the player types in. There are no accounts, so there is nothing to
-- authenticate: a cleared browser is a new player, and two browsers are two
-- players. That is the honest trade for not asking anyone to sign up.
--
-- Written and read only by the Vercel edge function using the service-role key.
-- RLS is enabled with no policies, which denies every anon and authenticated
-- request; the service role bypasses RLS by design.

create table if not exists public.leaderboard_scores (
  -- Anonymous, client-generated player identity. Not a Supabase auth user;
  -- there is no auth in this game.
  player_id uuid not null,
  -- The puzzle this score belongs to, as the player's own local calendar date --
  -- the same date key the game stores progress under. Only the live puzzle is
  -- ever submitted, so this is always "today" for whoever sent it; archive play
  -- stays off the board the same way it stays off the streak.
  puzzle_date date not null,

  -- The player's best word, not a name they typed: what the board shows beside a
  -- score is the rarest word that player has ever found (see
  -- src/game/leaderboard.ts's boardName). It moves when they beat it, so it is
  -- denormalised onto every row rather than kept in a players table -- a change
  -- should show up across their whole history without a join, and one row per
  -- player per day is few enough that rewriting it on each is free.
  --
  -- Constrained to a word rather than to a length. There are no accounts here, so
  -- this column is written from an unauthenticated endpoint; a pattern this tight
  -- means nothing expressible in it is invisible, right-to-left, or a passable
  -- imitation of the page's own text. 30 is the longest word the game accepts.
  display_name text not null check (display_name ~ '^[a-z]{2,30}$'),

  -- What that word is worth under *today's* scoring, sent by the client with the
  -- name and kept beside it. Stored rather than derived because the database has
  -- no dictionary: it holds scores, not words, and cannot look one up.
  --
  -- It travels with the name so the two can never disagree. The alternative --
  -- showing max(top_score) as the player's best -- looked equivalent and is not:
  -- top_score is frozen at the scoring system in effect the day it was played,
  -- so the largest of them can belong to a different word than the name, or be a
  -- number that word no longer scores. A row reading "asphyxiate - best 8.40"
  -- when asphyxiate is worth 8.30 today is a small lie, and an avoidable one.
  display_score numeric not null check (display_score >= 0 and display_score <= 10),

  -- The two numbers the game already shows the player: the summed rarity score
  -- of every accepted word, and the best single word. Bounds are the most a
  -- day's puzzle can physically produce (six guesses at a perfect 10), checked
  -- here as well as in the endpoint so a bad row cannot be written at all.
  total_score numeric not null check (total_score >= 0 and total_score <= 60),
  -- The best single word *of that day*, scored the way that day scored -- kept as
  -- the per-day record it is. Not what the board displays as a player's best:
  -- that is display_score above, which is about the player rather than the day.
  top_score numeric not null check (top_score >= 0 and top_score <= 10),
  words smallint not null check (words >= 0 and words <= 6),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One score per player per puzzle. A player submits repeatedly through a
  -- single day's play (once per accepted word), and each submission replaces
  -- the day's row rather than adding to it.
  primary key (player_id, puzzle_date)
);

comment on table public.leaderboard_scores is
  'One score per anonymous player per puzzle date. Read by /api/leaderboard to build the weekly and all-time boards.';

-- The weekly board's scan: every row inside a date window, biggest first.
create index if not exists leaderboard_scores_date_idx
  on public.leaderboard_scores (puzzle_date desc);

alter table public.leaderboard_scores enable row level security;
revoke all on public.leaderboard_scores from anon, authenticated;

/*
 * Submit a player's scores -- one puzzle, or a whole history at once.
 *
 * Takes an array because it has two callers with the same shape: the game
 * submits a single day after each accepted word, and a player joining the board
 * submits every past puzzle their browser still remembers playing. A batch is
 * one round trip and one transaction, which matters when the batch is a year
 * long.
 *
 * Monotonic on purpose: a day's score only ever goes up. Submissions arrive in
 * whatever order the network delivers them, so taking the max means a
 * late-arriving early submission cannot undo a better one, a re-sent backfill is
 * a no-op, and a second browser on the same player id cannot lower a day, only
 * raise it.
 *
 * The display name and its score are *not* max'd -- the newest pair always wins,
 * and always together. They are the player's best word and what it is worth
 * today, recomputed by the client on every submission, so beating it renames
 * them across their whole history on the next word they play.
 *
 * Returns how many days were written, which the endpoint reports back.
 */
create or replace function public.submit_leaderboard_scores(
  p_player_id uuid,
  p_display_name text,
  p_display_score numeric,
  p_scores jsonb
) returns integer
language sql
as $$
  with incoming as (
    select
      (s ->> 'date')::date as puzzle_date,
      (s ->> 'total')::numeric as total_score,
      (s ->> 'top')::numeric as top_score,
      (s ->> 'words')::smallint as words
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per date before the insert sees it: a batch could name the same day
  -- twice, and ON CONFLICT cannot resolve a conflict against a row the same
  -- statement is still inserting.
  deduped as (
    select puzzle_date, max(total_score) as total_score,
           max(top_score) as top_score, max(words) as words
    from incoming
    group by puzzle_date
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, display_name, display_score, total_score, top_score, words)
    select p_player_id, d.puzzle_date, p_display_name, p_display_score,
           d.total_score, d.top_score, d.words
    from deduped d
    on conflict (player_id, puzzle_date) do update set
      display_name = excluded.display_name,
      display_score = excluded.display_score,
      total_score = greatest(public.leaderboard_scores.total_score, excluded.total_score),
      top_score = greatest(public.leaderboard_scores.top_score, excluded.top_score),
      words = greatest(public.leaderboard_scores.words, excluded.words),
      updated_at = now()
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.submit_leaderboard_scores(uuid, text, numeric, jsonb)
  from public, anon, authenticated;

/*
 * One board, aggregated over a date window.
 *
 * `p_since` null means all time; a date means "on or after", which is how the
 * weekly board gets its reset -- nothing is deleted or archived when a week
 * turns over, the window simply moves and last week's rows fall out of it. That
 * keeps the all-time board a straight sum of the same rows and makes the weekly
 * reset unlosable: there is no scheduled job that can fail to run.
 *
 * Nothing here knows which day the week starts on. The caller computes the
 * window's first day from the player's own calendar (src/game/week.ts, currently
 * Sunday) and passes it in, so moving the boundary is a one-file change and
 * never a migration.
 *
 * Ranked by summed total score, which rewards playing every day rather than
 * peaking once -- the intended shape for a daily game. Ties break on the best
 * single word, then on who got there first, so a rank is always determinate.
 *
 * The rank is returned rather than left for a caller to infer from row order:
 * it is what the page displays, so the database that decided the ordering is
 * the thing that should say it.
 */
create or replace function public.leaderboard_board(
  p_since date default null,
  p_limit integer default 50
) returns table (
  rank integer,
  player_id uuid,
  display_name text,
  total_score numeric,
  best_score numeric,
  puzzles integer
)
language sql
stable
as $$
  with totals as (
    select
      s.player_id,
      -- Name and score both read off the player's most recent row, so a better
      -- word shows up across their whole history rather than only on the day
      -- they found it -- and so the number always describes the word beside it.
      -- Aggregated identically on purpose: same ordering, same row.
      (array_agg(s.display_name order by s.puzzle_date desc))[1] as display_name,
      (array_agg(s.display_score order by s.puzzle_date desc))[1] as best_score,
      round(sum(s.total_score), 1) as total_score,
      count(*)::integer as puzzles,
      min(s.created_at) as joined_at
    from public.leaderboard_scores s
    where p_since is null or s.puzzle_date >= p_since
    group by s.player_id
  )
  select
    row_number() over (
      order by t.total_score desc, t.best_score desc, t.joined_at asc
    )::integer as rank,
    t.player_id,
    t.display_name,
    t.total_score,
    t.best_score,
    t.puzzles
  from totals t
  order by rank
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.leaderboard_board(date, integer) from public, anon, authenticated;

/*
 * Both boards, and the gate in front of them.
 *
 * A leaderboard with three names on it is not a leaderboard, it is a list of
 * whoever happened to find the page first -- and it teaches a new player that
 * nobody plays this. So the boards stay collected but unpublished until
 * `p_min_players` distinct players have scored all time, at which point they
 * appear for everyone at once.
 *
 * The gate lives here rather than in the endpoint or the page on purpose: below
 * the threshold no row leaves the database at all, so there is no partial board
 * sitting in an API response waiting to be read out of the network tab. What a
 * caller gets instead is the count, which is the honest thing to show -- "four
 * of ten players so far" is a reason to come back.
 *
 * One function returning JSON rather than three calls: the count and both boards
 * are one question ("what should this page show right now"), and answering it in
 * one round trip means the count can never disagree with the rows beside it.
 */
create or replace function public.leaderboard_boards(
  p_since date,
  p_limit integer default 50,
  p_min_players integer default 10
) returns jsonb
language sql
stable
as $$
  with gate as (
    select
      count(distinct s.player_id)::integer as players,
      greatest(coalesce(p_min_players, 10), 0) as needed
    from public.leaderboard_scores s
  )
  select jsonb_build_object(
    'ready', g.players >= g.needed,
    'players', g.players,
    'minPlayers', g.needed,
    -- Aggregated in rank order, so the array a caller receives is already the
    -- board top to bottom and nothing downstream has to re-sort it.
    'weekly', case when g.players >= g.needed then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit) b
    ) else '[]'::jsonb end,
    'allTime', case when g.players >= g.needed then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(null, p_limit) b
    ) else '[]'::jsonb end
  )
  from gate g;
$$;

revoke all on function public.leaderboard_boards(date, integer, integer)
  from public, anon, authenticated;
