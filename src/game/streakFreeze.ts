/**
 * Streak freezes: missed days that do not cost the streak.
 *
 * An all-or-nothing streak punishes hardest the players it should keep. Someone
 * a few days in who misses a Saturday drops to zero, and a streak that is gone
 * stops being a reason to come back. So a player who cannot hold a freeze yet
 * gets a single missed day covered, with nothing to earn or bank: the grace
 * day (or free day) is applied automatically on the next load after the
 * missed day, and only follows a played day.
 *
 * Past that, a missed day is covered only by a saved freeze
 * (`bankedFreezes`), earned one for every seven days played -- the streak
 * count, which frozen days do not add to -- and held up to a cap set by the
 * longest streak the player has ever had (see `streakFreezeCap`). The cap is
 * permanent: a player who once reached 28 days can hold three on every streak
 * after, so a returning player starts earning from their first week. Once a
 * player has a cap, the grace day is gone for good (see `graceDays`): every
 * missed day spends a saved freeze or ends the streak. Saved freezes are spent
 * one per missed day, and only when there are enough to cover the whole gap
 * -- a gap they cannot cover resets the streak and the freezes go with it,
 * though the cap stays.
 *
 * So the day after a covered day is a day a streak can be lost if no saved
 * freeze is left, and that is when `atRisk` is true and the streak shows ⏳.
 * The streak shows 🧊 while a saved freeze is covering (see
 * `savedFreezeCovering` and components/StreakDisplay.tsx), at risk or not, and
 * on the grace day when a saved freeze is left to cover today
 * (`missedYesterday`). Playing turns it back to fire.
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
 * The most saved freezes a player whose longest streak is `days` can hold:
 * none in the first week, one from 7 days, two from 14, three from 28. A
 * freeze earned past the cap is not kept.
 */
export function freezeCap(days: number): number {
  if (days >= 28) return 3;
  if (days >= 14) return 2;
  if (days >= 7) return 1;
  return 0;
}

/** The cap for this player: set by the longest streak they have ever had. */
export function streakFreezeCap(streak: StreakState): number {
  return freezeCap(Math.max(streak.longestStreak, streak.currentStreak));
}

/**
 * Missed days covered for free after a played day: one until the player has a
 * freeze cap, none after. A player who can hold freezes covers every missed
 * day with one or loses the streak.
 */
export function graceDays(streak: StreakState): number {
  return streakFreezeCap(streak) > 0 ? 0 : 1;
}

/** Saved freezes after the streak reaches `currentStreak` played days. */
export function earnFreeze(streak: StreakState): StreakState {
  const banked = streak.bankedFreezes ?? 0;
  if (streak.currentStreak === 0 || streak.currentStreak % DAYS_PER_EARNED_FREEZE !== 0) {
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
 * last covered are covered by the grace day (when the last covered day was
 * played and the player has no freeze cap yet) and then by saved freezes, or the streak resets. Unchanged when
 * nothing was missed.
 */
export function applyFreezes(streak: StreakState, today: string): StreakState {
  const yesterday = addDays(today, -1);
  const covered = coveredThrough(streak);
  if (streak.currentStreak === 0 || !covered || covered >= yesterday) return streak;

  const missed = daysSinceEpoch(yesterday, covered);
  // Only a played day can be followed by the grace day: a covered day cannot.
  const grace = covered === streak.lastCompletedDate ? graceDays(streak) : 0;
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
 * Whether a saved freeze, not the grace day, is what is keeping the streak
 * alive today: more days have gone unplayed since the last played day than the
 * grace day covers -- two or more without a freeze cap, one or more with one
 * -- and today has not been played yet.
 */
export function savedFreezeCovering(streak: StreakState, today: string): boolean {
  if (streak.currentStreak === 0 || !streak.lastCompletedDate) return false;
  return daysSinceEpoch(today, streak.lastCompletedDate) - 1 > graceDays(streak);
}

/**
 * Whether yesterday went unplayed and was covered, and today is not played
 * yet: no grace day is left, so only a saved freeze stands between the
 * streak and missing today. The streak board's `covered`.
 */
export function missedYesterday(streak: StreakState, today: string): boolean {
  return (
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== today &&
    wasFrozen(streak, addDays(today, -1))
  );
}

/**
 * Whether the streak is lost if `today` goes unplayed: yesterday was covered,
 * so there is no grace day, and no saved freeze is left. The streak board's
 * `atRisk`.
 */
export function atRisk(streak: StreakState, today: string): boolean {
  return missedYesterday(streak, today) && (streak.bankedFreezes ?? 0) === 0;
}

/**
 * The streak as it stood on its last played day, which is what the streak
 * board is sent (see game/leaderboard.ts). The board works out the rest from
 * that day alone: the run is alive while the days missed since are no more
 * than the grace day (none once the reported best sets a freeze cap) plus the
 * freezes saved then. So the saved count is the one from before any were spent
 * on the gap -- every covered day since the last played day took one, past
 * the grace day when there is one.
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
    saved: (streak.bankedFreezes ?? 0) + Math.max(0, coveredSince - graceDays(streak)),
    lastPlayed,
  };
}

/** Whether a freeze covered `date`. */
export function wasFrozen(streak: StreakState, date: string): boolean {
  return (streak.frozenDates ?? []).includes(date);
}
