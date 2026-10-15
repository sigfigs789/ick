/**
 * Streak freezes: missed days that do not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * forty days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So a single missed day is always covered,
 * for every player, with nothing to earn or bank: the grace day is applied
 * automatically on the next load after the missed day.
 *
 * The grace day only follows a played day. Past it, a missed day is covered
 * only by a saved freeze (`bankedFreezes`), which a long streak earns: one for
 * every seven days played -- the streak count, which frozen days do not add to
 * -- held up to a cap that grows with the streak (see `freezeCap`). Saved freezes are spent one per missed day, after the grace
 * day, and only when there are enough to cover the whole gap -- a gap they
 * cannot cover resets the streak and they go with it.
 *
 * So the day after a covered day is a day a streak can be lost if no saved
 * freeze is left, and that is when `atRisk` is true. The streak shows 🧊 instead
 * of 🔥 on any day after a covered one (see `isFrozen` and
 * components/StreakDisplay.tsx). Playing that day turns it back to fire.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 */

import { addDays, daysSinceEpoch } from "./date";
import type { StreakState } from "./types";

/**
 * How long a covered day is remembered. Only the current month is ever asked
 * about (perfect month), so two months is room to spare without the list
 * growing for ever.
 */
const FROZEN_DATES_KEPT_DAYS = 62;

/** A saved freeze is earned on every seventh day played in a streak. */
const DAYS_PER_EARNED_FREEZE = 7;

/**
 * The most saved freezes a streak of `days` can hold: none under two weeks,
 * one until thirty days, two from then on. A freeze earned past the cap is
 * not kept.
 */
export function freezeCap(days: number): number {
  if (days >= 30) return 2;
  if (days >= 14) return 1;
  return 0;
}

/** Saved freezes after the streak reaches `currentStreak` played days. */
export function earnFreeze(streak: StreakState): StreakState {
  const banked = streak.bankedFreezes ?? 0;
  if (streak.currentStreak === 0 || streak.currentStreak % DAYS_PER_EARNED_FREEZE !== 0) {
    return streak;
  }
  const earned = Math.min(banked + 1, freezeCap(streak.currentStreak));
  return earned > banked ? { ...streak, bankedFreezes: earned } : streak;
}

/** The last day the streak reaches: the last day played, or a later frozen one. */
export function coveredThrough(streak: StreakState): string | undefined {
  let latest = streak.lastCompletedDate;
  for (const frozen of streak.frozenDates ?? []) {
    if (!latest || frozen > latest) latest = frozen;
  }
  return latest;
}

/**
 * The streak as it stands on `today`: the missed days since the streak was
 * last covered are covered by the grace day (when the last covered day was
 * played) and then by saved freezes, or the streak resets. Unchanged when
 * nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const yesterday = addDays(today, -1);
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= yesterday) return streak;

  const missed = daysSinceEpoch(yesterday, covered);
  // Only a played day can be followed by the grace day: a covered day cannot.
  const grace = covered === streak.lastCompletedDate ? 1 : 0;
  const banked = streak.bankedFreezes ?? 0;
  const spent = missed - grace;
  if (spent > banked) return { ...streak, currentStreak: 0, bankedFreezes: 0 };

  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  const newlyFrozen = Array.from({ length: missed }, (_, i) => addDays(covered, i + 1));
  return {
    ...streak,
    bankedFreezes: banked - spent,
    frozenDates: [...(streak.frozenDates ?? []), ...newlyFrozen].filter((d) => d >= keepFrom),
  };
}

/**
 * Whether yesterday was covered rather than played and today has not been
 * played yet: the streak is being held by a freeze.
 */
export function isFrozen(streak: StreakState, today: string): boolean {
  return (
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== today &&
    wasFrozen(streak, addDays(today, -1))
  );
}

/**
 * Whether the streak is lost if `today` goes unplayed: yesterday was covered,
 * so there is no grace day, and no saved freeze is left.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return isFrozen(streak, today) && (streak.bankedFreezes ?? 0) === 0;
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
