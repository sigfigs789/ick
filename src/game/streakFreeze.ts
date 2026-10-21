/**
 * Streak freezes: missed days that do not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * a few days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So a streak earns saved freezes
 * (`bankedFreezes`) early: the first on its third day played, then one on
 * every seventh day played -- the streak count, which frozen days do not add
 * to -- held up to a cap set by the longest streak the player has ever had
 * (see `streakFreezeCap`). The cap is permanent: a player who once reached 28
 * days can hold three on every streak after.
 *
 * There is no free missed day: every missed day spends a saved freeze or ends
 * the streak. Saved freezes are spent one per missed day, and only when there
 * are enough to cover the whole gap -- a gap they cannot cover resets the
 * streak and the freezes go with it, though the cap stays.
 *
 * So the day after a covered day is a day a streak can be lost if no saved
 * freeze is left, and that is when `atRisk` is true and the streak shows ⏳.
 * Otherwise it shows 🧊 while a saved freeze is covering (see
 * `savedFreezeCovering` and components/StreakDisplay.tsx). Playing turns it
 * back to fire.
 *
 * A frozen day keeps the streak alive but does not add to it: the count is
 * still days actually played. And it is remembered (`frozenDates`), because a
 * perfect month means every day played, and a covered day was not
 * (see game/perfectMonth.ts).
 */

import { addDays, daysSinceEpoch } from "./date";
import type { FreezeCount, StreakState } from "./types";

/**
 * How long a covered day is remembered. Only the current month is ever asked
 * about (perfect month), so two months is room to spare without the list
 * growing for ever.
 */
const FROZEN_DATES_KEPT_DAYS = 62;

/** The first saved freeze is earned on a streak's third day played. */
const FIRST_FREEZE_DAY = 3;

/** After that, one is earned on every seventh day played in a streak. */
const DAYS_PER_EARNED_FREEZE = 7;

/**
 * The most saved freezes a player whose longest streak is `days` can hold:
 * none in the first two days, one from 3 days, two from 14, three from 28. A
 * freeze earned past the cap is not kept.
 */
export function freezeCap(days: number): number {
  if (days >= 28) return 3;
  if (days >= 14) return 2;
  if (days >= FIRST_FREEZE_DAY) return 1;
  return 0;
}

/** The cap for this player: set by the longest streak they have ever had. */
export function streakFreezeCap(streak: StreakState): number {
  return freezeCap(Math.max(streak.longestStreak, streak.currentStreak));
}

/** Saved freezes after the streak reaches `currentStreak` played days. */
export function earnFreeze(streak: StreakState): StreakState {
  const banked = streak.bankedFreezes ?? 0;
  const days = streak.currentStreak;
  if (days === 0 || (days !== FIRST_FREEZE_DAY && days % DAYS_PER_EARNED_FREEZE !== 0)) {
    return streak;
  }
  const earned = Math.min(banked + 1, streakFreezeCap(streak));
  return earned > banked ? { ...streak, bankedFreezes: earned } : streak;
}

/**
 * Give a live streak the saved freezes it would hold had freezes existed all
 * along, once. Saved freezes shipped on 2026-10-15 with every streak at none,
 * so a player who had once run 48 days, now on a short new run, had nothing
 * to cover a second missed day. This fills the streak to its cap -- set by the
 * longest streak ever, so it is the cap they have already earned -- however
 * long the current run is, and marks it so it never runs again. Never takes
 * freezes away; a player who spent one since 10-15 gets it back, which is the
 * generous side to err on.
 */
export function backdateFreezes(streak: StreakState): StreakState {
  if (streak.freezesBackdated || streak.currentStreak === 0) return streak;
  const banked = streak.bankedFreezes ?? 0;
  return {
    ...streak,
    bankedFreezes: Math.max(banked, streakFreezeCap(streak)),
    freezesBackdated: true,
  };
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
 * last covered are covered by saved freezes, one each, or the streak resets.
 * Unchanged when nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const yesterday = addDays(today, -1);
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= yesterday) return streak;

  const missed = daysSinceEpoch(yesterday, covered);
  const banked = streak.bankedFreezes ?? 0;
  const keepFrom = addDays(today, -FROZEN_DATES_KEPT_DAYS);
  const cap = streakFreezeCap(streak);
  const missedDates = Array.from({ length: missed }, (_, i) => addDays(covered, i + 1)).filter(
    (d) => d >= keepFrom
  );
  if (missed > banked) {
    // The freezes went with the streak, from the first missed day.
    const lost = missedDates.map((d): [string, FreezeCount] => [d, { banked: 0, cap }]);
    return {
      ...streak,
      currentStreak: 0,
      bankedFreezes: 0,
      freezeHistory: keptHistory({ ...streak.freezeHistory, ...Object.fromEntries(lost) }, keepFrom),
    };
  }

  // Each covered day spent one, so it ends the day with one fewer than the last.
  const spent = missedDates.map((d): [string, FreezeCount] => [
    d,
    { banked: banked - daysSinceEpoch(d, covered), cap },
  ]);
  return {
    ...streak,
    bankedFreezes: banked - missed,
    frozenDates: [...(streak.frozenDates ?? []), ...missedDates].filter((d) => d >= keepFrom),
    freezeHistory: keptHistory({ ...streak.freezeHistory, ...Object.fromEntries(spent) }, keepFrom),
  };
}

function keptHistory(
  history: Record<string, FreezeCount>,
  keepFrom: string
): Record<string, FreezeCount> {
  return Object.fromEntries(Object.entries(history).filter(([d]) => d >= keepFrom));
}

/** The streak with the saved freezes it holds now recorded as `date`'s. */
export function recordFreezes(streak: StreakState, date: string): StreakState {
  const keepFrom = addDays(date, -FROZEN_DATES_KEPT_DAYS);
  const count = { banked: streak.bankedFreezes ?? 0, cap: streakFreezeCap(streak) };
  return {
    ...streak,
    freezeHistory: keptHistory({ ...streak.freezeHistory, [date]: count }, keepFrom),
  };
}

/**
 * The saved freezes and cap the streak held at the end of `date`, for a past
 * puzzle. A day with no record -- before records were kept, or never played
 * nor covered -- shows the ones held now, as every day did before.
 */
export function freezesOn(streak: StreakState, date: string | undefined): FreezeCount {
  const recorded = date === undefined ? undefined : streak.freezeHistory?.[date];
  return recorded ?? { banked: streak.bankedFreezes ?? 0, cap: streakFreezeCap(streak) };
}

/**
 * Whether a saved freeze is what is keeping the streak alive today: a day has
 * gone unplayed since the last played day, and today has not been played yet.
 */
export function savedFreezeCovering(streak: StreakState, today: string): boolean {
  if (streak.currentStreak === 0 || !streak.lastCompletedDate) return false;
  return daysSinceEpoch(today, streak.lastCompletedDate) > 1;
}

/**
 * Whether yesterday went unplayed and was covered, and today is not played
 * yet: only a saved freeze stands between the streak and missing today. The
 * streak board's `covered`.
 */
export function missedYesterday(streak: StreakState, today: string): boolean {
  return (
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== today &&
    wasFrozen(streak, addDays(today, -1))
  );
}

/**
 * Whether the streak is lost if `today` goes unplayed: yesterday was covered
 * and no saved freeze is left. The streak board's `atRisk`.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return missedYesterday(streak, today) && (streak.bankedFreezes ?? 0) === 0;
}

/**
 * The streak as it stood on its last played day, which is what the streak
 * board is sent (see game/leaderboard.ts). The board works out the rest from
 * that day alone: the run is alive while the days missed since are no more
 * than the freezes saved then. So the saved count is the one from before any
 * were spent on the gap -- every covered day since the last played day took
 * one.
 */
export function streakReport(
  streak: StreakState
): { current: number; best: number; saved: number; lastPlayed: string } | null {
  const lastPlayed = streak.lastCompletedDate;
  if (streak.currentStreak === 0 || !lastPlayed) return null;
  const coveredSince = (streak.frozenDates ?? []).filter((d) => d > lastPlayed).length;
  return {
    current: streak.currentStreak,
    best: Math.max(streak.longestStreak, streak.currentStreak),
    saved: (streak.bankedFreezes ?? 0) + coveredSince,
    lastPlayed,
  };
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
