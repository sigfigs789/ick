/**
 * Streak freezes: one missed day that does not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * forty days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So every seventh day in a row earns a
 * freeze, up to two held at once. A freeze is spent automatically on the next
 * load after a missed day -- the player does nothing -- and covers that day.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 *
 * Several missed days are covered only if there are freezes for all of them.
 * Spending one on a gap it cannot close would lose the freeze and the streak
 * both, so a gap too long to bridge resets the streak and leaves the freezes
 * where they were.
 */

import { addDays, daysSinceEpoch } from "./date";
import type { StreakState } from "./types";

/** Consecutive played days that earn one freeze. */
export const FREEZE_EVERY = 7;
/** Freezes a player can hold at once. */
export const MAX_FREEZES = 2;

/**
 * How long a covered day is remembered. Only the current month is ever asked
 * about (perfect month), so two months is room to spare without the list
 * growing for ever.
 */
const FROZEN_DATES_KEPT_DAYS = 62;

/** The last day the streak reaches: the last day played, or a later frozen one. */
export function coveredThrough(streak: StreakState): string | undefined {
  let latest = streak.lastCompletedDate;
  for (const frozen of streak.frozenDates ?? []) {
    if (!latest || frozen > latest) latest = frozen;
  }
  return latest;
}

/**
 * The streak as it stands on `today`: missed days covered by freezes if there
 * are enough of them, otherwise reset. Unchanged when nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const yesterday = addDays(today, -1);
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= yesterday) return streak;

  const missed = daysSinceEpoch(yesterday, covered);
  const freezes = streak.freezes ?? 0;
  if (missed > freezes) return { ...streak, currentStreak: 0 };

  const newlyFrozen = Array.from({ length: missed }, (_, i) => addDays(covered, i + 1));
  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  return {
    ...streak,
    freezes: freezes - missed,
    frozenDates: [...(streak.frozenDates ?? []), ...newlyFrozen].filter((d) => d >= keepFrom),
  };
}

/**
 * A freeze for reaching a multiple of FREEZE_EVERY, if the player has room for
 * one. Called with the streak already advanced to today.
 */
export function earnFreeze(streak: StreakState): StreakState {
  const freezes = streak.freezes ?? 0;
  if (streak.currentStreak === 0 || streak.currentStreak % FREEZE_EVERY !== 0) return streak;
  if (freezes >= MAX_FREEZES) return streak;
  return { ...streak, freezes: freezes + 1 };
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
