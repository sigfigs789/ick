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
-- A freshly created table grants nothing to anybody but its owner, and the edge
-- functions reach Postgres as `service_role` -- so without this the endpoint is
-- denied its own tables. Row-level security stays on with no policies, which is
-- what keeps `anon` and `authenticated` out; `service_role` bypasses RLS by
-- design, and these grants are what let it through the privilege check first.
grant select, insert, update on public.leaderboard_scores to service_role;

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

-- Revoking from PUBLIC is what actually locks a function down -- `anon` and
-- `authenticated` hold no grant of their own, they inherit PUBLIC's. But so does
-- `service_role`, which is the role PostgREST assumes when the edge functions
-- present the service key: revoke from PUBLIC alone and the endpoint gets
-- "permission denied for function" on its own procedures. So every function the
-- server calls is revoked from everyone and then granted back to exactly the one
-- role that needs it.
revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_scores(uuid, jsonb) to service_role;

/*
 * The name a player chose for themselves, when they have chosen one.
 *
 * A name is always one of the player's own finds -- there is no free-text field
 * anywhere in this feature -- but which find is theirs to pick. Left alone, the
 * board calls them by their rarest word ever, which is a good default and a bad
 * permanent arrangement: it moves every time they beat it, so a player on a good
 * run keeps changing names and the rivals watching for them lose track. Choosing
 * is how a player pins it.
 *
 * One row per player rather than a column on every score row: this is a fact
 * about the player, not about a day, and there is nothing to keep in step.
 *
 * The word is *not* trusted from the client. `choose_leaderboard_name` will only
 * write a word that already appears among that player's own submitted days, and
 * takes the frequency from that row rather than from the request -- so a name
 * cannot be a word somebody never played, and cannot arrive carrying a rarity it
 * did not earn.
 */
create table if not exists public.leaderboard_names (
  player_id uuid primary key,
  -- Constrained to a word for the same reason top_word is: these values are
  -- shown to other players, and nothing expressible here should be invisible,
  -- right-to-left, or a passable imitation of the page's own text.
  display_name text not null check (display_name ~ '^[a-z]{2,30}$'),
  -- The chosen word's frequency, copied from the player's own row at the time it
  -- was chosen, so the board can price it without a second lookup.
  display_zipf numeric not null check (display_zipf >= -10 and display_zipf <= 10),
  chosen_at timestamptz not null default now()
);

comment on table public.leaderboard_names is
  'The word a player chose to be known by, which must be one of their own finds. Absent means "call me by my rarest".';

alter table public.leaderboard_names enable row level security;
revoke all on public.leaderboard_names from anon, authenticated;
grant select, insert, update on public.leaderboard_names to service_role;

/*
 * Choose a name, or fail.
 *
 * The whole authorisation rule is the `where exists`: the word has to be one this
 * player has actually submitted. That is what makes an unauthenticated endpoint
 * safe to expose here -- there is no name anyone can claim that they did not earn
 * under their own player id, so the worst a forged request can do is rename the
 * player whose id it already knows to a word that player themselves found.
 *
 * Returns true when the name was set, false when the word is not one of theirs --
 * which the endpoint reports rather than silently accepting.
 */
create or replace function public.choose_leaderboard_name(
  p_player_id uuid,
  p_name text
) returns boolean
language plpgsql
as $$
declare
  earned_zipf numeric;
begin
  -- The rarest row bearing this word, so a word played on several days is
  -- priced at its best showing.
  select s.top_zipf into earned_zipf
    from public.leaderboard_scores s
   where s.player_id = p_player_id
     and s.top_word = p_name
   order by s.top_zipf asc
   limit 1;

  if earned_zipf is null then
    return false;
  end if;

  insert into public.leaderboard_names (player_id, display_name, display_zipf)
  values (p_player_id, p_name, earned_zipf)
  on conflict (player_id) do update set
    display_name = excluded.display_name,
    display_zipf = excluded.display_zipf,
    chosen_at = now();
  return true;
end;
$$;

revoke all on function public.choose_leaderboard_name(uuid, text)
  from public, anon, authenticated;
grant execute on function public.choose_leaderboard_name(uuid, text) to service_role;

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
 *   * `name` / `name_zipf` -- what to call the player, ignoring the window: the
 *     word they chose if they chose one, otherwise their rarest ever. This is
 *     their identity, and it has to be stable: a name that changed week to week
 *     would make a rival unrecognisable, and being beaten by someone you
 *     recognise is most of why a weekly board is worth returning to. The default
 *     is stable enough to start with and moves when they beat their best;
 *     choosing is how a player stops it moving at all.
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
  -- The identity, over every row a player has, whatever the window is. A chosen
  -- name wins; the rarest word ever is the fallback for everyone who has not
  -- picked one, which is most players and all new ones.
  with rarest as (
    select distinct on (s.player_id)
      s.player_id, s.top_word as name, s.top_zipf as name_zipf
    from public.leaderboard_scores s
    order by s.player_id, s.top_zipf asc, s.puzzle_date asc
  ),
  identity as (
    select
      r.player_id,
      coalesce(n.display_name, r.name) as name,
      coalesce(n.display_zipf, r.name_zipf) as name_zipf
    from rarest r
    left join public.leaderboard_names n on n.player_id = r.player_id
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
grant execute on function public.leaderboard_board(date, integer) to service_role;

/*
 * The words players actually found, rarest first.
 *
 * One row per distinct word, drawn from the same score rows the boards are built
 * from -- so every word here is the best one some player found on some day, which
 * is the interesting half of what this table holds. A word several people found
 * appears once, with the count.
 *
 * `p_before` is the spoiler gate and it is not optional. The game is a daily
 * puzzle with the same drop for everybody, so publishing a word somebody found
 * today hands the answer to everyone who has not played yet. Only dates strictly
 * before `p_before` are returned, and the caller is responsible for passing a
 * date no later than the earliest "today" any player could currently be on (see
 * api/leaderboard.ts, which takes the earlier of the client's own date and UTC's,
 * so neither a timezone nor a lying client can widen it).
 *
 * The effect is a day's finds becoming visible the day after, which is a feature
 * as much as a constraint: there is something to come back for tomorrow, and it
 * is never something that spoils today.
 */
create or replace function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 12
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
  -- Rarest first: the whole point is the words worth looking at. Ties go to the
  -- word more people found, then alphabetically so the order never wobbles
  -- between two identical calls.
  order by min(s.top_zipf) asc, count(distinct s.player_id) desc, s.top_word asc
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;

/*
 * Both boards, and the gate in front of them.
 *
 * Scores are collected from the first day and the boards are published on a
 * chosen date, whatever the data looks like by then. `p_open` carries that
 * decision, made by the endpoint from the calendar rather than from the size of
 * the table -- a launch nobody can put a date on is one nobody plans around.
 *
 * The gate still lives here rather than only in the page: while it is shut, no
 * board row leaves the database at all, so there is no early board sitting in an
 * API response waiting to be read out of the network tab.
 *
 * One function returning JSON rather than three calls: the count and both boards
 * are one question ("what should this page show right now"), and answering it in
 * one round trip means the count can never disagree with the rows beside it.
 */
create or replace function public.leaderboard_boards(
  p_since date,
  p_limit integer default 50,
  p_open boolean default false,
  p_words_before date default null,
  p_words_since date default null
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ready', coalesce(p_open, false),
    -- Aggregated in rank order, so the array a caller receives is already the
    -- board top to bottom and nothing downstream has to re-sort it.
    'weekly', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(p_since, p_limit) b
    ) else '[]'::jsonb end,
    'allTime', case when coalesce(p_open, false) then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
      from public.leaderboard_board(null, p_limit) b
    ) else '[]'::jsonb end,
    -- Deliberately *outside* the gate: the finds feed works from day one, and
    -- it is the best thing to show a player while the boards wait for their
    -- opening date.
    'words', case when p_words_before is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
      from public.leaderboard_words(p_words_before, p_words_since, 12) w
    ) end
  );
$$;

revoke all on function public.leaderboard_boards(date, integer, boolean, date, date)
  from public, anon, authenticated;
grant execute on function public.leaderboard_boards(date, integer, boolean, date, date) to service_role;
