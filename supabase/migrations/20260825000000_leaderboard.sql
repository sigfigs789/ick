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

  -- Denormalised onto every row rather than kept in a players table: a rename
  -- should show up on the board immediately and without a join, and one row per
  -- player per day is few enough rows that rewriting the name on each is free.
  display_name text not null,

  -- The two numbers the game already shows the player: the summed rarity score
  -- of every accepted word, and the best single word. Bounds are the most a
  -- day's puzzle can physically produce (six guesses at a perfect 10), checked
  -- here as well as in the endpoint so a bad row cannot be written at all.
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
 * Submit one puzzle's score.
 *
 * Monotonic on purpose: a day's score only ever goes up. The client submits
 * after every accepted word, and those arrive in whatever order the network
 * delivers them -- taking the max means a late-arriving early submission cannot
 * undo a better one. It also means a second browser on the same player id
 * cannot lower the day's score, only raise it.
 *
 * The display name is *not* max'd -- the newest one always wins, so renaming
 * takes effect on the next submission.
 */
create or replace function public.submit_leaderboard_score(
  p_player_id uuid,
  p_puzzle_date date,
  p_display_name text,
  p_total_score numeric,
  p_top_score numeric,
  p_words smallint
) returns void
language sql
as $$
  insert into public.leaderboard_scores
    (player_id, puzzle_date, display_name, total_score, top_score, words)
  values
    (p_player_id, p_puzzle_date, p_display_name, p_total_score, p_top_score, p_words)
  on conflict (player_id, puzzle_date) do update set
    display_name = excluded.display_name,
    total_score = greatest(public.leaderboard_scores.total_score, excluded.total_score),
    top_score = greatest(public.leaderboard_scores.top_score, excluded.top_score),
    words = greatest(public.leaderboard_scores.words, excluded.words),
    updated_at = now();
$$;

revoke all on function public.submit_leaderboard_score(uuid, date, text, numeric, numeric, smallint)
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
 * Ranked by summed score, which rewards playing every day rather than peaking
 * once -- the intended shape for a daily game. Ties break on the best single
 * word, then on who got there first, so a rank is always determinate.
 */
create or replace function public.leaderboard_board(
  p_since date default null,
  p_limit integer default 50
) returns table (
  player_id uuid,
  display_name text,
  total_score numeric,
  best_score numeric,
  puzzles integer
)
language sql
stable
as $$
  select
    s.player_id,
    -- The name from the player's most recent submission, so a rename shows up
    -- across their whole history rather than only on the days they renamed.
    (array_agg(s.display_name order by s.puzzle_date desc))[1] as display_name,
    round(sum(s.total_score), 1) as total_score,
    max(s.top_score) as best_score,
    count(*)::integer as puzzles
  from public.leaderboard_scores s
  where p_since is null or s.puzzle_date >= p_since
  group by s.player_id
  order by total_score desc, best_score desc, min(s.created_at) asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.leaderboard_board(date, integer) from public, anon, authenticated;
