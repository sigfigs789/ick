-- The streak board accepts up to three saved freezes.
--
-- The cap now steps up every week a player has ever reached: one from 7 days,
-- two from 14, three from 28 (`freezeCap` in src/game/streakFreeze.ts). It was
-- one from 14 and two from 30, and 20261016000000 held `saved_freezes` to
-- that. A report of three would fail the check and drop the player's streak
-- write, so the bound moves with the cap. Nothing else reads the cap: the
-- board's alive and at-risk tests already take the saved count as reported.
alter table public.leaderboard_player_streaks
  drop constraint if exists leaderboard_player_streaks_saved_freezes_check;

alter table public.leaderboard_player_streaks
  add constraint leaderboard_player_streaks_saved_freezes_check
  check (saved_freezes between 0 and 3);
