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

  -- The rarest word of *that day*, and its Zipf frequency.
  --
  -- Stored per day rather than as one denormalised "current name" per player,
  -- because both things the board needs are derived from these rows and so can
  -- never disagree with each other:
  --   * a player's name is the rarest word across *all* their rows -- a stable
  --     identity that changes only when they beat it;
  --   * the weekly board's detail is the rarest word inside the *window*, which
  --     is what they found this week.
  --
  -- Ordered by Zipf rather than by score, which is what lets the database pick a
  -- rarest word with no dictionary of its own: every scoring system this game
  -- has used maps Zipf to score monotonically downward, so the smallest Zipf is
  -- the rarest word under any of them. The client turns it back into a score
  -- with today's dictionary.
  --
  -- Constrained to a word rather than to a length. There are no accounts here, so
  -- this column is written from an unauthenticated endpoint and displayed to
  -- other players; a pattern this tight means nothing expressible in it is
  -- invisible, right-to-left, or a passable imitation of the page's own text. 30
  -- is the longest word the game accepts.
  top_word text not null check (top_word ~ '^[a-z]{2,30}$'),
  -- Zipf runs roughly -2 (a word no corpus attests) to 8 ("the"); bounded wide.
  top_zipf numeric not null check (top_zipf >= -10 and top_zipf <= 10),

  -- The summed rarity score of every word accepted that day, and the best single
  -- one of them -- both as that day's own scoring system scored them, because a
  -- past game keeps the result it was played for. Bounds are the most a day can
  -- physically produce (six guesses at a perfect 10), checked here as well as in
  -- the endpoint so a bad row cannot be written at all.
  total_score numeric not null check (total_score >= 0 and total_score <= 60),
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
 * No name parameter: a player's name is derived from these rows (see the table
 * comment), so there is nothing to pass and nothing that can drift out of step
 * with the scores it sits beside.
 *
 * Monotonic on purpose: a day's score only ever goes up. Submissions arrive in
 * whatever order the network delivers them, so taking the max means a
 * late-arriving early submission cannot undo a better one, a re-sent backfill is
 * a no-op, and a second browser on the same player id cannot lower a day, only
 * raise it. The day's word moves with it -- whichever submission won on score
 * brought the word that earned it.
 *
 * Returns how many days were written, which the endpoint reports back.
 */
create or replace function public.submit_leaderboard_scores(
  p_player_id uuid,
  p_scores jsonb
) returns integer
language sql
as $$
  with incoming as (
    select
      (s ->> 'date')::date as puzzle_date,
      (s ->> 'word')::text as top_word,
      (s ->> 'zipf')::numeric as top_zipf,
      (s ->> 'total')::numeric as total_score,
      (s ->> 'top')::numeric as top_score,
      (s ->> 'words')::smallint as words
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per date before the insert sees it: a batch could name the same day
  -- twice, and ON CONFLICT cannot resolve a conflict against a row the same
  -- statement is still inserting. Ranked rather than max()'d per column, so the
  -- day's word and its numbers come from the same entry.
  deduped as (
    select distinct on (puzzle_date)
      puzzle_date, top_word, top_zipf, total_score, top_score, words
    from incoming
    order by puzzle_date, total_score desc, top_zipf asc
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, top_word, top_zipf, total_score, top_score, words)
    select p_player_id, d.puzzle_date, d.top_word, d.top_zipf,
           d.total_score, d.top_score, d.words
    from deduped d
    on conflict (player_id, puzzle_date) do update set
      total_score = greatest(public.leaderboard_scores.total_score, excluded.total_score),
      top_score = greatest(public.leaderboard_scores.top_score, excluded.top_score),
      words = greatest(public.leaderboard_scores.words, excluded.words),
      -- The word follows the score it came with: replaced only when this
      -- submission is the one raising the day, so the word on the row is always
      -- the word that earned the number on the row.
      top_word = case
        when excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_word else public.leaderboard_scores.top_word end,
      top_zipf = case
        when excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_zipf else public.leaderboard_scores.top_zipf end,
      updated_at = now()
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
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
 * peaking once -- the intended shape for a daily game. Ties break on the rarest
 * word found in the window, then on who got there first, so a rank is always
 * determinate. The rank is returned rather than left for a caller to infer from
 * row order: it is what the page displays, so the database that decided the
 * ordering is the thing that should say it.
 *
 * Two different words come back, and the difference is the point:
 *
 *   * `name` / `name_zipf` -- the rarest word across the player's *entire*
 *     history, ignoring the window. This is their identity, and it has to be
 *     stable: a name that changed every week would make a rival unrecognisable
 *     week to week, and being beaten by someone you recognise is most of why a
 *     weekly board is worth returning to.
 *   * `window_word` / `window_zipf` -- the rarest word *inside* the window, which
 *     on the weekly board is what they found this week. This is what makes a
 *     weekly row describe the week rather than quietly reporting an all-time
 *     figure. On the all-time board the window is everything, so the two agree.
 *
 * Both are picked by smallest Zipf, which needs no dictionary here: every scoring
 * system this game has used maps Zipf to score monotonically downward, so the
 * smallest Zipf is the rarest word under any of them. Scores are the client's job
 * -- it has the dictionary, and it can apply today's.
 */
create or replace function public.leaderboard_board(
  p_since date default null,
  p_limit integer default 50
) returns table (
  rank integer,
  player_id uuid,
  name text,
  name_zipf numeric,
  window_word text,
  window_zipf numeric,
  total_score numeric,
  puzzles integer
)
language sql
stable
as $$
  -- The identity, over every row a player has, whatever the window is.
  with identity as (
    select distinct on (s.player_id)
      s.player_id, s.top_word as name, s.top_zipf as name_zipf
    from public.leaderboard_scores s
    order by s.player_id, s.top_zipf asc, s.puzzle_date asc
  ),
  -- The window: what they scored, and the rarest thing they found, inside it.
  windowed as (
    select
      s.player_id,
      round(sum(s.total_score), 1) as total_score,
      count(*)::integer as puzzles,
      min(s.created_at) as joined_at,
      -- The rarest word of the window, and its Zipf. Picked together so the word
      -- and the number always describe each other.
      (array_agg(s.top_word order by s.top_zipf asc, s.puzzle_date asc))[1] as window_word,
      min(s.top_zipf) as window_zipf
    from public.leaderboard_scores s
    where p_since is null or s.puzzle_date >= p_since
    group by s.player_id
  )
  select
    row_number() over (
      order by w.total_score desc, w.window_zipf asc, w.joined_at asc
    )::integer as rank,
    w.player_id,
    i.name,
    i.name_zipf,
    w.window_word,
    w.window_zipf,
    w.total_score,
    w.puzzles
  from windowed w
  join identity i on i.player_id = w.player_id
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
