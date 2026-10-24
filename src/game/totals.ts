/**
 * What the player has scored inside the week and the month the puzzle sits in.
 *
 * Read from this browser's own record rather than from the leaderboard, which
 * is what keeps a shared result synchronous and available to somebody who never
 * joined a board. The arithmetic is the boards': a window total is the sum of
 * each day's `totalRarityScore`, scored at that day's own date, over the days
 * inside the window (see leaderboard.scoreFor) -- for the week, only the best
 * WEEK_BEST_DAYS of them, as the weekly board counts, and for the month only the
 * best MONTH_BEST_DAYS from October 2026 on, as the monthly board counts. So a player who has been
 * submitting all along reads the same number here that the board shows them.
 *
 * Only days played on their own calendar date count, the same eligibility the
 * board imports under (see storage.playedOnItsDay) -- an afternoon spent in the
 * archive does not inflate the week.
 *
 * And only the days that count on *this result's own board*, for the same
 * reason: these numbers promise to agree with the board, and there is one board
 * per mode from the choice date on (see mode.boardFor). A browser that has
 * played both ways holds a record of each, so without this a shared Standard
 * week would count a Freeform afternoon the Standard board never saw --
 * inflated by exactly the scores Freeform hands out for skipping the fold.
 *
 * The board is the one the puzzle being shared belongs to, not the one the
 * switch is set to right now: a result is about a day that was played, and a
 * player flipping the switch after the fact does not move the week it sat in.
 * Days from before the split count either way, because they are on both boards.
 *
 * Windowed against the puzzle's date, not the wall clock: the totals belong to
 * the result being shared, so replaying an old puzzle reports that puzzle's week
 * and month rather than this one's.
 */

import { todayDateString } from "./date";
import { totalRarityScore } from "./dictionary";
import { monthBestDays, monthStart } from "./month";
import { countsOnBoard, modeForDate, type GameMode } from "./mode";
import { playedOnItsDay } from "./storage";
import { WEEK_BEST_DAYS, weekStart } from "./week";

export interface WindowTotals {
  /** Summed rarity score across the puzzle's week, from its first day (see game/week.ts), best WEEK_BEST_DAYS days. */
  week: number;
  /** Summed rarity score across the puzzle's calendar month, best MONTH_BEST_DAYS days from October 2026. */
  month: number;
}

export function windowTotals(
  date: string = todayDateString(),
  mode: GameMode = modeForDate(date)
): WindowTotals {
  const week = weekStart(date);
  const month = monthStart(date);
  // Which board these two numbers promise to agree with. A pre-split date has no
  // board of its own -- it is on both -- and `modeForDate` answers it from the
  // calendar, which is the board those days were actually ranked on.
  const board = mode;
  const weekDays: number[] = [];
  const monthDays: number[] = [];
  for (const progress of playedOnItsDay()) {
    // Days after the puzzle being shared are somebody else's window as far as
    // this result is concerned, and would read as a total the player cannot
    // account for.
    if (progress.date > date) continue;
    if (!countsOnBoard(board, progress.date, progress.mode)) continue;
    const score = totalRarityScore(progress.acceptedWords, progress.date);
    if (progress.date >= week) weekDays.push(score);
    if (progress.date >= month) monthDays.push(score);
  }
  return {
    week: round(bestDaysTotal(weekDays, WEEK_BEST_DAYS)),
    month: round(bestDaysTotal(monthDays, monthBestDays(month))),
  };
}

/** The sum of the `best` highest of `days`, as the boards' `p_best` counts them. */
function bestDaysTotal(days: number[], best: number): number {
  return days
    .sort((a, b) => b - a)
    .slice(0, best)
    .reduce((sum, score) => sum + score, 0);
}

// Rounded once at the end rather than per day, so the window total matches the
// sum a player adds up from their own daily totals. To hundredths, like the
// daily totals themselves and like the boards that add them up -- a week of
// two-decimal days does not come to a round tenth, and rounding it to one would
// put this number a hundredth away from the board it promises to agree with.
function round(total: number): number {
  return Math.round(total * 100) / 100;
}
