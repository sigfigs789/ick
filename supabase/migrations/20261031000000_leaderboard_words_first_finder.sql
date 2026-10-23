/*
 * The finds feed names who found each word first.
 *
 * "Yesterday's Best Word" on the play screen reveals the day's rarest find and
 * the player who got there first. `found_at` is written once per player per
 * word and never updated (see 20260828000000_leaderboard_finds), so the
 * earliest one is the first arrival. A tie, which needs two submissions in the
 * same microsecond, goes to the lower id so every reader sees the same name.
 *
 * Only the id is returned. The name a player goes by is derived from it on the
 * client (see game/handle.ts), exactly as the boards do.
 *
 * Dropped and recreated, because the return type changes. `leaderboard_public_words`
 * names its columns (20260925010000), so the Reddit build's feed keeps its shape,
 * and `leaderboard_boards` reads this through `to_jsonb`, where an extra key is
 * ignored by the API. Safe in either order against the API: the previous one
 * ignores the new column, and the new one reads a missing `first_player` as none.
 */

drop function if exists public.leaderboard_words(date, date, integer);

create function public.leaderboard_words(
  p_before date,
  p_since date,
  p_limit integer default 500
) returns table (
  word text,
  zipf numeric,
  finders integer,
  found_on date,
  standard boolean,
  first_player uuid
)
language sql
stable
as $$
  select
    f.word,
    min(f.zipf) as zipf,
    count(distinct f.player_id)::integer as finders,
    max(f.puzzle_date) as found_on,
    bool_or(f.mode = 'standard') as standard,
    (array_agg(f.player_id order by f.found_at asc, f.player_id asc))[1] as first_player
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
