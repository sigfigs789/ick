import type { StreakState } from "./types";

/**
 * The longest streak a streak starting or carrying on today has to beat, kept
 * on the streak from its first day (see `bestToBeat` on StreakState).
 *
 * A new streak takes the best so far: none for a player's first ever streak,
 * which has nothing to beat. One carrying on keeps what it started with. A
 * streak from a save before this was kept is chasing the best only if it is
 * still behind it; one level with it may have set it, so it chases nothing.
 */
export function bestToBeat(streak: StreakState, continues: boolean): number {
  if (!continues) return streak.longestStreak;
  if (streak.bestToBeat !== undefined) return streak.bestToBeat;
  return streak.currentStreak < streak.longestStreak ? streak.longestStreak : 0;
}

/**
 * The best a streak played today has just passed, or null: only on the one day
 * it first goes above it. Every day after is a longer record still, but the
 * record was already broken, so it is not celebrated again.
 */
export function beatBestToday(streak: StreakState, today: string): number | null {
  const best = streak.bestToBeat ?? 0;
  if (streak.lastCompletedDate !== today || best === 0) return null;
  return streak.currentStreak === best + 1 ? best : null;
}
