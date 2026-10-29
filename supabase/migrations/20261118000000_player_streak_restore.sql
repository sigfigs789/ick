-- A player's own streak, read back so a fresh browser can carry it on.
--
-- The streak lives in the browser (`ick:streak`, see src/game/storage.ts), and
-- the board keeps only what each game reports of it
-- (leaderboard_player_streaks, see 20261016000000). Muse AI plays every run in
-- a new browser under the id it played as before (`adoptPlayerFromUrl` in
-- src/game/player.ts), so it kept its board rows but started every streak
-- over at one. This hands that browser the streak as last reported, and the
-- days played around it, which the game rebuilds its own streak from (see
-- src/game/streakRestore.ts).
--
-- `played_dates` are the days on the board in the two weeks up to
-- `last_played`: what the game keeps to decide whether a weekend was earned
-- off (`playedDates`, see `isRestDay` in src/game/streakFreeze.ts). A day
-- reaches leaderboard_scores only when it was played on its own day, which is
-- the same line the streak draws. `days_played` is every such day, for the
-- puzzles-played count.
--
-- No row for a player with no reported streak.

create or replace function public.player_streak_restore(p_player uuid)
returns table (
  current_streak integer,
  best_streak integer,
  saved_freezes integer,
  last_played date,
  played_dates date[],
  days_played integer
)
language sql
stable
as $$
  select
    s.current_streak,
    s.best_streak,
    s.saved_freezes,
    s.last_played,
    coalesce(
      (
        select array_agg(distinct d.puzzle_date order by d.puzzle_date)
        from public.leaderboard_scores d
        where d.player_id = p_player
          and d.puzzle_date between s.last_played - 14 and s.last_played
      ),
      '{}'::date[]
    ),
    (
      select count(distinct d.puzzle_date)::integer
      from public.leaderboard_scores d
      where d.player_id = p_player
    )
  from public.leaderboard_player_streaks s
  where s.player_id = p_player;
$$;

revoke all on function public.player_streak_restore(uuid) from public, anon, authenticated;
grant execute on function public.player_streak_restore(uuid) to service_role;
