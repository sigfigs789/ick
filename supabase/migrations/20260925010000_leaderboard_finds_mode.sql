/*
 * Record which mode each find was made in.
 *
 * Goes back on one call 20260925000000_leaderboard_modes made: that migration
 * left `leaderboard_finds` without a mode on purpose, since the feed is one
 * list. It stays one list. The mode is what lets each reader leave out the
 * finds their own rules refuse.
 *
 * From MODE_CHOICE_START (2026-09-27) Freeform accepts obsolete, archaic and
 * dated words that Standard refuses, and both modes' finds share one feed. The
 * client hides from a Standard reader any find Standard would refuse, but it can
 * only judge a word its own lists know. A word only Merriam-Webster has judged
 * -- archaic to MW, absent from the curated list, the metadata and the corpus --
 * looks the same offline whether it plays in Standard or not. What does tell
 * them apart is whether anybody found it *in* Standard, which is what this
 * column records and `leaderboard_words` now reports.
 *
 * Three changes:
 *   - `leaderboard_finds.mode`, 'standard' or 'freeform'. Existing rows are
 *     Standard except the trial week (2026-09-14 through 2026-09-26), which
 *     everybody played in Freeform by the calendar.
 *   - `submit_leaderboard_scores` writes it from each day's `mode` (absent means
 *     Standard), and upgrades a Freeform find to Standard when the same player
 *     banks the word in Standard as well. Before the split the mode is the
 *     calendar's, as the board's 'shared' is. Otherwise identical to the
 *     20260925000000_leaderboard_modes definition it replaces.
 *   - `leaderboard_words` returns `standard`: whether any finder banked the word
 *     in Standard. Dropped and recreated, because the return type changes, and
 *     `leaderboard_public_words` is recreated beside it with its own columns
 *     named, so the Reddit build's feed keeps its shape.
 *
 * Safe in either order against the client and API. The client already sends
 * `mode` on every day (see 20260925000000_leaderboard_modes); the previous API
 * ignores the new column, and the new one reads a missing `standard` as true.
 */

alter table public.leaderboard_finds
  add column if not exists mode text not null default 'standard'
  check (mode in ('standard', 'freeform'));

comment on column public.leaderboard_finds.mode is
  'Which rules the find was banked under. Standard wins when a player banks the word in both.';

update public.leaderboard_finds
  set mode = 'freeform'
  where puzzle_date between date '2026-09-14' and date '2026-09-26'
    and mode = 'standard';

-- The upgrade in submit_leaderboard_scores is the first write that updates a
-- find, and it touches this one column. Granted explicitly, like everything
-- else service_role uses: its rights do not come from PUBLIC.
grant update (mode) on public.leaderboard_finds to service_role;

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
      (s ->> 'words')::smallint as words,
      coalesce((s ->> 'retried')::boolean, false) as retried,
      -- Kept from 20260923000000, and still meaning "no board at all": archive
      -- play, the feed's repair, a client below MIN_RANKED_VERSION, and a
      -- Freeform day from a client that predates this migration and so sends it
      -- that way. Absent reads as false.
      coalesce((s ->> 'unranked')::boolean, false) as unranked,
      -- Derived, not trusted. A day before the split is 'shared' however it was
      -- labelled, and a day after it is the mode it was played in -- bounded to
      -- the two real ones, so an unrecognised label reads as Standard rather
      -- than writing a row no board will ever select.
      case
        when (s ->> 'date')::date < public.leaderboard_mode_split() then 'shared'
        when (s ->> 'mode') = 'freeform' then 'freeform'
        else 'standard'
      end as mode,
      -- The rules the day's finds were banked under, which unlike the board has
      -- no 'shared': a find is always one mode or the other. Before the split it
      -- is the calendar's -- the trial week Freeform, everything else Standard --
      -- so a client cannot relabel an old day; from the split it is the mode sent.
      case
        when (s ->> 'date')::date < public.leaderboard_mode_split() then
          case when (s ->> 'date')::date >= date '2026-09-14' then 'freeform' else 'standard' end
        when (s ->> 'mode') = 'freeform' then 'freeform'
        else 'standard'
      end as find_mode,
      s -> 'found' as found
    from jsonb_array_elements(p_scores) as s
  ),
  -- One row per day *and board* before the insert sees it: a batch carries both
  -- modes of the same puzzle from a browser that played it both ways, and those
  -- are two rows rather than a conflict to resolve. Within one board the rule is
  -- what it was -- the post-retry entry outranks a pre-retry one whatever the
  -- two scores are, because it is the newer account of the day rather than the
  -- better one.
  deduped as (
    select distinct on (puzzle_date, mode)
      puzzle_date, mode, top_word, top_zipf, total_score, top_score, words, retried
    from incoming
    -- Unranked days go no further than the finds below.
    where not unranked
    order by puzzle_date, mode, retried desc, total_score desc, top_zipf asc
  ),
  -- The feed, which has no modes: a word is a word whichever rules the finder
  -- was playing under, and this table has never carried a score to disagree
  -- about. Deduped across modes as well as within one, so a player who found the
  -- same word both ways writes it once -- which is already what the primary key
  -- says, and saying it here means the row that lands is chosen rather than
  -- whichever the planner reached first.
  --
  -- Where a batch carries the word in both modes, the Standard one is the row
  -- that lands: it is the stronger claim, since it says the word plays under the
  -- stricter rules.
  finds as (
    select distinct on (i.puzzle_date, (f ->> 'word'))
      i.puzzle_date,
      (f ->> 'word')::text as word,
      (f ->> 'zipf')::numeric as zipf,
      i.find_mode as mode
    from incoming i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.found) = 'array' then i.found else '[]'::jsonb end
    ) as f
    order by i.puzzle_date, (f ->> 'word'), (i.find_mode = 'standard') desc,
      (f ->> 'zipf')::numeric asc
  ),
  -- A repeat is still discarded, with one exception: a word this player first
  -- banked in Freeform and has now banked in Standard too is upgraded to
  -- Standard. Nothing else on the row moves -- `found_at` in particular stays
  -- the first sighting, which is what the feed orders on.
  found_written as (
    insert into public.leaderboard_finds (player_id, puzzle_date, word, zipf, mode)
    select p_player_id, f.puzzle_date, f.word, f.zipf, f.mode
    from finds f
    on conflict (player_id, puzzle_date, word) do update set mode = 'standard'
      where public.leaderboard_finds.mode = 'freeform' and excluded.mode = 'standard'
    returning 1
  ),
  written as (
    insert into public.leaderboard_scores
      (player_id, puzzle_date, mode, top_word, top_zipf, total_score, top_score, words, retried)
    select p_player_id, d.puzzle_date, d.mode, d.top_word, d.top_zipf,
           d.total_score, d.top_score, d.words, d.retried
    from deduped d
    on conflict (player_id, puzzle_date, mode) do update set
      total_score = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.total_score
        else greatest(public.leaderboard_scores.total_score, excluded.total_score) end,
      top_score = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.top_score
        else greatest(public.leaderboard_scores.top_score, excluded.top_score) end,
      words = case
        when excluded.retried and not public.leaderboard_scores.retried
          then excluded.words
        else greatest(public.leaderboard_scores.words, excluded.words) end,
      top_word = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_word else public.leaderboard_scores.top_word end,
      top_zipf = case
        when (excluded.retried and not public.leaderboard_scores.retried)
          or excluded.total_score >= public.leaderboard_scores.total_score
          then excluded.top_zipf else public.leaderboard_scores.top_zipf end,
      retried = public.leaderboard_scores.retried or excluded.retried,
      updated_at = now()
    where excluded.retried or not public.leaderboard_scores.retried
    returning 1
  )
  select count(*)::integer from written;
$$;

revoke all on function public.submit_leaderboard_scores(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_scores(uuid, jsonb) to service_role;

drop function if exists public.leaderboard_words(date, date, integer);

/*
 * The finds feed, as 20260831000000 defined it, plus `standard`: whether any
 * finder banked the word in Standard. A Standard reader is shown a word only if
 * somebody found it in Standard or Standard's own lists accept it (see
 * repriceFoundWords in src/game/leaderboard.ts).
 */
create function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 500
) returns table (
  word text,
  zipf numeric,
  finders integer,
  found_on date,
  standard boolean
)
language sql
stable
as $$
  select
    f.word,
    min(f.zipf) as zipf,
    count(distinct f.player_id)::integer as finders,
    max(f.puzzle_date) as found_on,
    bool_or(f.mode = 'standard') as standard
  from public.leaderboard_finds f
  where f.puzzle_date < p_before
    and f.puzzle_date >= p_since
  group by f.word
  order by max(f.found_at) desc, f.word asc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

revoke all on function public.leaderboard_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_words(date, date, integer) to service_role;


/*
 * The Reddit build's feed, unchanged in shape. It used to `select *` from
 * `leaderboard_words`, which would now return a column this function does not
 * declare; the columns are named instead.
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
  select w.word, w.zipf, w.finders, w.found_on
  from public.leaderboard_words(p_before, p_since, least(greatest(coalesce(p_limit, 500), 1), 500)) w;
$$;

revoke all on function public.leaderboard_public_words(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.leaderboard_public_words(date, date, integer) to anon, service_role;
