/**
 * What the player has scored inside the week the puzzle sits in.
 *
 * Read from this browser's own record rather than from the leaderboard, which
 * is what keeps a shared result synchronous and available to somebody who never
 * joined a board. The arithmetic is the weekly board's: the sum of each day's
 * `totalRarityScore`, scored at that day's own date, over the days inside the
 * window (see leaderboard.scoreFor). So a player who has been submitting all
 * along reads the same number here that the board shows them.
 *
 * Only days played on their own calendar date count, the same eligibility the
 * board imports under (see storage.playedOnItsDay) -- an afternoon spent in the
 * archive does not inflate the week.
 *
 * Windowed against the puzzle's date, not the wall clock: the total belongs to
 * the result being shared, so replaying an old puzzle reports that puzzle's week
 * rather than this one's.
 */

import { todayDateString } from "./date";
import { totalRarityScore } from "./dictionary";
import { playedOnItsDay } from "./storage";
import { weekStart } from "./week";

/** Summed rarity score across the puzzle's week, Sunday onward. */
export function weekTotal(date: string = todayDateString()): number {
  const start = weekStart(date);
  let total = 0;
  for (const progress of playedOnItsDay()) {
    // Days outside the window on either side: before its Sunday, or after the
    // puzzle being shared, which would read as a total the player cannot
    // account for.
    if (progress.date < start || progress.date > date) continue;
    total += totalRarityScore(progress.acceptedWords, progress.date);
  }
  // Rounded once at the end rather than per day, so the week matches the sum a
  // player adds up from their own daily totals.
  return Math.round(total * 10) / 10;
}
