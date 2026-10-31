/**
 * The do-over: a second retry, earned by playing DO_OVER_PLAYS of a week's
 * puzzles, each on its own day (the same days the lazy weekend counts, see
 * `weekPlays` in game/streakFreeze.ts). It is spent like the puzzle's own
 * retry, on today's puzzle only, once the puzzle's own retry is gone -- so a
 * puzzle played while it is held has two retries.
 *
 * It does not stack: a week earns one, and a week whose do-over is spent
 * earns no other. Nor does it carry over: it is that week's or nothing, like
 * the lazy weekend. The week is the board's, Monday to Sunday (see game/week.ts).
 *
 * While it is held, a finished puzzle keeps its word of the day hidden even
 * once its own retry is gone, so a player who retries a word, finishes again,
 * and still holds the do-over can spend it there too. Once the word has been
 * revealed (see storage.forfeitRetry) the do-over cannot be used on that
 * puzzle: it would re-open a puzzle whose best word is known. The reveal
 * itself never spends the do-over; the week keeps it for another day.
 */

import { addDays, daysSinceEpoch } from "./date";
import type { StreakState } from "./types";
import { weekEnd, weekStart } from "./week";

/** Days played in a week, each on its own day, that earn its do-over. */
export const DO_OVER_PLAYS = 4;

/** The do-over's emoji, wherever it is shown. */
export const DO_OVER_EMOJI = "🔄";

/** The first day of the week whose do-over is spent, kept apart from both modes' puzzles. */
const SPENT_KEY = "ick:do-over-spent";

/** The days of `today`'s week, through `today`, played on their own day. */
export function doOverPlays(streak: StreakState, today: string): number {
  const from = weekStart(today);
  return (streak.playedDates ?? []).filter((d) => d >= from && d <= today).length;
}

/** Whether `today`'s week's do-over is spent. */
export function doOverSpent(today: string): boolean {
  try {
    return localStorage.getItem(SPENT_KEY) === weekStart(today);
  } catch {
    // A do-over that cannot be marked spent is not offered (see `doOverHeld`).
    return true;
  }
}

/** Mark `today`'s week's do-over spent. */
export function spendDoOver(today: string): void {
  try {
    localStorage.setItem(SPENT_KEY, weekStart(today));
  } catch {
    // Nothing to do: `doOverSpent` already reads unwritable storage as spent.
  }
}

/** Whether the do-over is earned this week and not yet spent. */
export function doOverHeld(streak: StreakState, today: string): boolean {
  return doOverPlays(streak, today) >= DO_OVER_PLAYS && !doOverSpent(today);
}

/**
 * Where the week stands, for the pie (see components/DoOverBadge.tsx): the
 * days played, whether DO_OVER_PLAYS can still be reached by the week's end,
 * and whether its do-over is spent.
 */
export function doOverProgress(
  streak: StreakState,
  today: string
): { played: number; reachable: boolean; spent: boolean } {
  const played = doOverPlays(streak, today);
  const playedToday = (streak.playedDates ?? []).includes(today);
  const left = daysSinceEpoch(weekEnd(weekStart(today)), today) + (playedToday ? 0 : 1);
  return { played, reachable: played + left >= DO_OVER_PLAYS, spent: doOverSpent(today) };
}

/**
 * Whether playing tomorrow earns the do-over: today is played, it is the
 * last day short, and tomorrow is in the same week. For the come-back line.
 */
export function doOverTomorrow(streak: StreakState, today: string): boolean {
  return (
    (streak.playedDates ?? []).includes(today) &&
    doOverPlays(streak, today) === DO_OVER_PLAYS - 1 &&
    weekStart(addDays(today, 1)) === weekStart(today) &&
    !doOverSpent(today)
  );
}
