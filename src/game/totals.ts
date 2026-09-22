/**
 * What the player has scored inside the week and the month the puzzle sits in.
 *
 * Read from this browser's own record rather than from the leaderboard, which
 * is what keeps a shared result synchronous and available to somebody who never
 * joined a board. The arithmetic is the boards': a window total is the sum of
 * each day's `totalRarityScore`, scored at that day's own date, over the days
 * inside the window (see leaderboard.scoreFor). So a player who has been
 * submitting all along reads the same number here that the board shows them.
 *
 * Only days played on their own calendar date count, the same eligibility the
 * board imports under (see storage.playedOnItsDay) -- an afternoon spent in the
 * archive does not inflate the week.
 *
 * And only days the board actually ranks, for the same reason: these numbers
 * promise to agree with the board, and a day the player chose to spend in
 * Freeform never reaches it (see leaderboard.submitScore). A browser that has
 * played both ways holds a record of each, so without this a shared week would
 * count a Freeform afternoon the board never saw -- inflated by exactly the
 * scores Freeform hands out for skipping the fold. The trial week still counts,
 * because it is still ranked. And a Freeform result says "Freeform" where these
 * two numbers go, rather than quoting totals from a window nothing compares.
 *
 * Windowed against the puzzle's date, not the wall clock: the totals belong to
 * the result being shared, so replaying an old puzzle reports that puzzle's week
 * and month rather than this one's.
 */

import { todayDateString } from "./date";
import { totalRarityScore } from "./dictionary";
import { monthStart } from "./month";
import { isRanked } from "./mode";
import { playedOnItsDay } from "./storage";
import { weekStart } from "./week";

export interface WindowTotals {
  /** Summed rarity score across the puzzle's week, Sunday onward. */
  week: number;
  /** Summed rarity score across the puzzle's calendar month. */
  month: number;
}

export function windowTotals(date: string = todayDateString()): WindowTotals {
  const week = weekStart(date);
  const month = monthStart(date);
  let weekTotal = 0;
  let monthTotal = 0;
  for (const progress of playedOnItsDay()) {
    // Days after the puzzle being shared are somebody else's window as far as
    // this result is concerned, and would read as a total the player cannot
    // account for.
    if (progress.date > date) continue;
    if (!isRanked(progress.date, progress.mode)) continue;
    const score = totalRarityScore(progress.acceptedWords, progress.date);
    if (progress.date >= week) weekTotal += score;
    if (progress.date >= month) monthTotal += score;
  }
  return { week: round(weekTotal), month: round(monthTotal) };
}

// Rounded once at the end rather than per day, so the window total matches the
// sum a player adds up from their own daily totals. To hundredths, like the
// daily totals themselves and like the boards that add them up -- a week of
// two-decimal days does not come to a round tenth, and rounding it to one would
// put this number a hundredth away from the board it promises to agree with.
function round(total: number): number {
  return Math.round(total * 100) / 100;
}
