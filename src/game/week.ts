/**
 * The weekly board's window.
 *
 * Weeks run **Sunday to Saturday** on the player's own wall clock, the same local
 * calendar the puzzle date itself comes from (see game/date.ts).
 *
 * Sunday rather than the ISO Monday, and the reason is onboarding rather than
 * convention. A weekly board is only worth playing while you can still win it,
 * so the question is what deficit a new arrival faces on the days people
 * actually arrive -- and for a casual daily game that is the weekend. With a
 * Sunday reset the weekend straddles the boundary: Saturday is the last day of
 * one week and Sunday is the first day of the next, so a large share of weekend
 * arrivals land on a board that is hours old and wide open. With a Monday reset
 * both weekend days sit at the far end of the week, five and six days down, and
 * a newcomer's first impression is a board they cannot catch. It also matches the
 * calendar the game's audience reads, where Sunday starts the week.
 *
 * Nothing is archived or deleted when a week turns over: the board is always
 * "scores from this week's Sunday onward", so the reset is a window moving rather
 * than a job that runs -- there is nothing to fail at midnight. And because the
 * window start is computed here and passed to the query, changing the first day
 * of the week is a change to this file alone; no SQL knows which day it is.
 *
 * Local rather than UTC because a reset should land at the player's midnight, not
 * at someone else's. The cost is that two players in different timezones can
 * briefly see slightly different weekly boards around the boundary, which is the
 * same harmless drift the daily puzzle already has.
 */

import { addDays, todayDateString } from "./date";

/** The Sunday on or before `date`, as YYYY-MM-DD. */
export function weekStart(date: string = todayDateString()): string {
  // getUTCDay on a UTC-midnight date reads the weekday of the calendar date
  // itself, with no chance of a host timezone offset shifting it a day. Sunday
  // is already 0 there, which is exactly the offset from the week's start.
  return addDays(date, -weekday(date));
}

/** Whole days until the current week's board resets, counting today. */
export function daysUntilReset(date: string = todayDateString()): number {
  return 7 - weekday(date);
}

/**
 * How long this week's board has left, in words -- the line under the weekly
 * heading. Said in days rather than hours: the board is scored per puzzle, so
 * what matters is how many more puzzles fit before the reset, not the clock.
 */
export function resetLabel(date: string = todayDateString()): string {
  const days = daysUntilReset(date);
  if (days === 1) return "Resets tonight";
  return `Resets in ${days} days`;
}

/** Days from the week's Sunday to `date`: 0 on Sunday, 6 on Saturday. */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
