/**
 * The weekly board's window.
 *
 * Weeks run Monday to Sunday on the player's own wall clock, the same local
 * calendar the puzzle date itself comes from (see game/date.ts). Nothing is
 * archived or deleted when a week turns over: the board is always "scores from
 * this week's Monday onward", so the reset is a window moving rather than a job
 * that runs -- there is nothing to fail at midnight.
 *
 * Local rather than UTC because a reset should land at the player's midnight,
 * not at someone else's. The cost is that two players in different timezones
 * can briefly see slightly different weekly boards around the boundary, which
 * is the same harmless drift the daily puzzle already has.
 */

import { addDays, todayDateString } from "./date";

/** The Monday on or before `date`, as YYYY-MM-DD. */
export function weekStart(date: string = todayDateString()): string {
  const [y, m, d] = date.split("-").map(Number);
  // getUTCDay on a UTC-midnight date reads the weekday of the calendar date
  // itself, with no chance of a host timezone offset shifting it a day.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // Sunday is 0 in JS, but ends the week here, so it is six days past Monday.
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

/** Whole days until the current week's board resets, counting today. */
export function daysUntilReset(date: string = todayDateString()): number {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return 7 - ((weekday + 6) % 7);
}

/**
 * How long this week's board has left, in words -- the line under the weekly
 * tab. Said in days rather than hours: the board is scored per puzzle, so what
 * matters is how many more puzzles fit before the reset, not the clock.
 */
export function resetLabel(date: string = todayDateString()): string {
  const days = daysUntilReset(date);
  if (days === 1) return "Resets tonight";
  return `Resets in ${days} days`;
}
