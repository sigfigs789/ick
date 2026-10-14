/**
 * Streak freezes: one missed day that does not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * forty days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So a single missed day is always covered,
 * for every player, with nothing to earn or bank: the freeze is applied
 * automatically on the next load after the missed day.
 *
 * What it buys is one day of grace, not two. A covered day has to be followed
 * by a played one; miss the day after a frozen day too and the streak resets.
 * So the day after a freeze is the one day a streak can be lost, and that is
 * when the streak shows 🧊 instead of 🔥 (see `atRisk` and
 * components/StreakDisplay.tsx). Playing that day turns it back to fire.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 */

import { addDays } from "./date";
import type { StreakState } from "./types";

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
 * The streak as it stands on `today`: a single missed day after a played one
 * is covered, anything longer resets. Unchanged when nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const yesterday = addDays(today, -1);
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= yesterday) return streak;

  // Only a played day can be followed by a frozen one: two frozen days in a
  // row, or a gap of two or more, ends the streak.
  const canFreeze = covered === addDays(yesterday, -1) && covered === streak.lastCompletedDate;
  if (!canFreeze) return { ...streak, currentStreak: 0 };

  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  return {
    ...streak,
    frozenDates: [...(streak.frozenDates ?? []), yesterday].filter((d) => d >= keepFrom),
  };
}

/**
 * Whether the streak is lost if `today` goes unplayed: yesterday was covered
 * by a freeze and today has not been played yet.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return (
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== today &&
    wasFrozen(streak, addDays(today, -1))
  );
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
