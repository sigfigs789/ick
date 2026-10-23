/**
 * Whether the player's average daily score is on the way up.
 *
 * The average is of each played day's total (see dictionary.totalRarityScore,
 * scored at that day's own date), and "on the way up" compares the last
 * IMPROVEMENT_WINDOW played days -- today's among them -- with the
 * IMPROVEMENT_WINDOW played days before those. A player with fewer than twice
 * MIN_WINDOW played days has no trend to speak of yet, and is not told one;
 * between that and the full window, both halves shrink to match, so the
 * comparison is always like for like.
 *
 * Asked only once today's puzzle is finished (every guess spent), because
 * that is when today's total stops moving. Earlier days count however many
 * guesses they used: those days are over, and what they scored is what they
 * scored. Played on its own day only, as the boards count (see
 * storage.playedOnItsDay): an afternoon in the archive is practice, not form.
 * And only the days on today's own board (see mode.countsOnBoard), because
 * Freeform skips the fold and scores higher -- a Standard player who tried
 * Freeform last week did not get worse when they came back.
 *
 * Read from this browser's own record, like the week and month totals (see
 * game/totals.ts), so it works for somebody who never joined a board.
 */

import { addDays } from "./date";
import { totalRarityScore } from "./dictionary";
import { countsOnBoard, modeForDate, type GameMode } from "./mode";
import { playedOnItsDay } from "./storage";

/** Played days on each side of the comparison, at most. */
export const IMPROVEMENT_WINDOW = 5;
/** Played days on each side before a trend is worth announcing. */
export const MIN_WINDOW = 3;
/**
 * How much higher the recent average has to be, as a fraction of the older one.
 * Enough that a few hundredths of drift does not throw a party.
 */
export const MIN_GAIN = 0.05;
/**
 * Days after one celebration before the next. An improving player improves for
 * a while, and a card every evening of it would stop being a celebration.
 */
export const IMPROVEMENT_COOLDOWN_DAYS = 7;

const CELEBRATED_KEY = "ick:improvementCelebrated";

export interface Improvement {
  /** Average daily total over the recent finished days, to the hundredth. */
  recent: number;
  /** Average daily total over the finished days before those. */
  earlier: number;
  /** Played days in each half. */
  days: number;
}

/**
 * The trend as of `date`'s puzzle, when it is a rise worth celebrating; null
 * when it is not, or when `date`'s puzzle is not finished on its own date.
 */
export function averageImprovement(
  date: string,
  mode: GameMode = modeForDate(date)
): Improvement | null {
  const totals = playedOnItsDay()
    .filter(
      (progress) =>
        (progress.date < date || (progress.date === date && progress.completed)) &&
        countsOnBoard(mode, progress.date, progress.mode)
    ); // By date already (see storage.playedHistory), so today is last.
  // Only today's finish is news. Without this, any later look at the record
  // would report a rise that ended days ago.
  const last = totals[totals.length - 1];
  if (!last || last.date !== date) return null;

  const days = Math.min(IMPROVEMENT_WINDOW, Math.floor(totals.length / 2));
  if (days < MIN_WINDOW) return null;

  const scores = totals.map((progress) =>
    totalRarityScore(progress.acceptedWords, progress.date)
  );
  const recent = average(scores.slice(-days));
  const earlier = average(scores.slice(-2 * days, -days));
  if (earlier <= 0 || recent < earlier * (1 + MIN_GAIN)) return null;
  return { recent: round(recent), earlier: round(earlier), days };
}

/**
 * Whether a rise on `date` may be celebrated: not already celebrated that day,
 * and not within IMPROVEMENT_COOLDOWN_DAYS of the last one.
 */
export function improvementCelebrationDue(date: string): boolean {
  const last = readCelebrated();
  if (!last) return true;
  return date >= addDays(last, IMPROVEMENT_COOLDOWN_DAYS);
}

/** Remember that `date`'s rise has been celebrated. */
export function markImprovementCelebrated(date: string): void {
  try {
    localStorage.setItem(CELEBRATED_KEY, date);
  } catch {
    // Storage that cannot be written means a second card on a reload, at worst.
  }
}

/** By how much the recent average beats the older one, as a whole percent. */
export function improvementPercent({ recent, earlier }: Improvement): number {
  return Math.round(((recent - earlier) / earlier) * 100);
}

function readCelebrated(): string | null {
  try {
    return localStorage.getItem(CELEBRATED_KEY);
  } catch {
    return null;
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
