/*
 * Who found a word on one puzzle, first finder first.
 *
 * The "yesterday's best" line under today's puzzle names a finder rather than
 * only counting them -- "Found by CalmOtter3 and 2 other players" -- and puts
 * the reader first when they were one of them. `leaderboard_words` only counts,
 * so this answers the one word the line shows.
 *
 * Player ids only: the client derives each handle from its id (game/handle.ts),
 * exactly as the boards do, and the boards already publish these ids.
 */
create or replace function public.leaderboard_word_finders(
  p_date date,
  p_word text,
  p_limit integer default 100
) returns table (
  player_id uuid
)
language sql
stable
as $$
  select f.player_id
  from public.leaderboard_finds f
  where f.puzzle_date = p_date
    and f.word = p_word
  order by f.found_at asc, f.player_id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke all on function public.leaderboard_word_finders(date, text, integer)
  from public, anon, authenticated;
-- Explicitly: service_role's rights do not come from PUBLIC.
grant execute on function public.leaderboard_word_finders(date, text, integer) to service_role;
