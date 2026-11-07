/**
 * The do-over: a second retry, earned by every DO_OVER_PLAYS (3) days played
 * (each on its own day, see `playedDates`). Only one is ever held, so days
 * played while one is held earn nothing more; but it never expires, and
 * spending it starts the count for the next. The count runs from the day
 * after the last one was spent, or from COUNT_FROM, when this rule began
 * (everyone started then at 0, with that week's days played counting).
 *
 * It is spent like the puzzle's own retry, on today's puzzle only, once the
 * puzzle's own retry is gone -- so a puzzle played while it is held has two
 * retries.
 *
 * A player who retries a word, finishes again, and still holds the do-over
 * can spend it there too. A puzzle whose word of the day was revealed back
 * when that was offered (see storage.answerRevealed) keeps the do-over off:
 * it would re-open a puzzle whose best word is known.
 */

import { addDays } from "./date";
import type { StreakState } from "./types";

/** Days played, each on its own day, that earn a do-over. */
export const DO_OVER_PLAYS = 3;

/** The do-over's emoji, wherever it is shown. */
export const DO_OVER_EMOJI = "🔄";

/** The first day whose play counts: the Monday the do-over stopped being weekly. */
export const COUNT_FROM = "2026-11-02";

/** The day the last do-over was spent. (The weekly one used "ick:do-over-spent".) */
const SPENT_KEY = "ick:do-over-spent-on";

/** The first day counting towards the next do-over; `null` when storage can't be read. */
function countFrom(): string | null {
  try {
    const spent = localStorage.getItem(SPENT_KEY);
    return spent && spent >= COUNT_FROM ? addDays(spent, 1) : COUNT_FROM;
  } catch {
    // A do-over that cannot be marked spent is not offered.
    return null;
  }
}

/** Days played through `today` towards the next do-over. */
export function doOverPlays(streak: StreakState, today: string): number {
  const from = countFrom();
  if (from === null) return 0;
  return (streak.playedDates ?? []).filter((d) => d >= from && d <= today).length;
}

/** Spend the do-over held on `today`. */
export function spendDoOver(today: string): void {
  try {
    localStorage.setItem(SPENT_KEY, today);
  } catch {
    // Nothing to do: `countFrom` reads unreadable storage as nothing earned.
  }
}

/** Whether a do-over is held. */
export function doOverHeld(streak: StreakState, today: string): boolean {
  return doOverPlays(streak, today) >= DO_OVER_PLAYS;
}

/** The days played towards the next do-over, at most DO_OVER_PLAYS, for the badge. */
export function doOverProgress(streak: StreakState, today: string): { played: number } {
  return { played: Math.min(DO_OVER_PLAYS, doOverPlays(streak, today)) };
}

/**
 * Whether playing tomorrow earns a do-over: today is played and it is the
 * last day short. For the come-back line.
 */
export function doOverTomorrow(streak: StreakState, today: string): boolean {
  return (streak.playedDates ?? []).includes(today) && doOverPlays(streak, today) === DO_OVER_PLAYS - 1;
}
