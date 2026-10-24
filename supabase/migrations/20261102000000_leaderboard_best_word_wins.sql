/*
 * How many days each player has had the best word, before one puzzle.
 *
 * The "yesterday's best" line under today's puzzle names the day's best word.
 * When two words tie for it, the line now goes to the word whose player it has
 * named least often (see pickBest in src/game/yesterdaysBest.ts), and this is
 * the tally it reads.
 *
 * Every puzzle before `p_before` is replayed in order, picking its best word by
 * the same rules the line uses:
 *   1. the rarest word -- the lowest Zipf;
 *   2. then the word whose player has the fewest best words so far, a word's
 *      player being its first finder;
 *   3. then the longer word;
 *   4. then a coin toss, fixed per day and word (md5) so the tally never
 *      changes between two reads.
 * The day's pick is credited to its first finder. Replayed rather than stored
 * because every tie depends on the tally before it.
 *
 * An approximation of what the line showed, not a record of it: the line prices
 * words in the browser, by the reader's mode and today's dictionary, and calls a
 * tie on the score it prints; this has only the Zipf each finder's game sent.
 * Close enough to keep one player from taking every tie.
 *
 * Player ids only, like leaderboard_word_finders.
 */
create or replace function public.leaderboard_best_word_wins(p_before date)
returns table (
  player_id uuid,
  wins integer
)
language plpgsql
stable
as $$
declare
  v_tally jsonb := '{}'::jsonb;
  v_day date;
  v_holder uuid;
begin
  for v_day in
    select distinct f.puzzle_date
    from public.leaderboard_finds f
    where f.puzzle_date < p_before
    order by f.puzzle_date
  loop
    select w.holder into v_holder
    from (
      select
        f.word,
        min(f.zipf) as zipf,
        (array_agg(f.player_id order by f.found_at asc, f.player_id asc))[1] as holder
      from public.leaderboard_finds f
      where f.puzzle_date = v_day
      group by f.word
    ) w
    order by
      w.zipf asc,
      coalesce((v_tally ->> w.holder::text)::integer, 0) asc,
      length(w.word) desc,
      md5(v_day::text || ':' || w.word) asc
    limit 1;

    v_tally := jsonb_set(
      v_tally,
      array[v_holder::text],
      to_jsonb(coalesce((v_tally ->> v_holder::text)::integer, 0) + 1)
    );
  end loop;

  return query
    select t.key::uuid, t.value::text::integer
    from jsonb_each(v_tally) t;
end;
$$;

revoke all on function public.leaderboard_best_word_wins(date)
  from public, anon, authenticated;
-- Explicitly: service_role's rights do not come from PUBLIC.
grant execute on function public.leaderboard_best_word_wins(date) to service_role;
