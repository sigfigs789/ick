/**
 * The monthly board's window.
 *
 * Months run on the player's own wall clock, the same local calendar the puzzle
 * date comes from (see game/date.ts) and for the same reason the week does (see
 * game/week.ts): a reset should land at the player's midnight, not at someone
 * else's.
 *
 * This board used to be a season -- a pair of fixed dates, "Aug 1 – Dec 31
 * 2026", held in two places and opened by hand. A month needs no opening: the
 * window is computed from the date being played, so the board turns over on the
 * first of every month with nothing to run and nothing to edit. Like the week,
 * nothing is archived or deleted at the boundary -- the board is always "scores
 * from this month's first onward", so the reset is a window moving rather than a
 * job that can fail.
 */

import { formatDateLabel, todayDateString } from "./date";

/** The first of the month `date` falls in, as YYYY-MM-DD. */
export function monthStart(date: string = todayDateString()): string {
  // String slicing rather than Date arithmetic: the first of the month is the
  // one date that is already written in the date it comes from, so there is
  // nothing here a timezone offset could shift.
  return `${date.slice(0, 7)}-01`;
}

/** The first of the month after the one `date` falls in -- the day it resets. */
export function nextMonthStart(date: string = todayDateString()): string {
  const [year, month] = monthStart(date).split("-").map(Number);
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * `Resets Sep 1`, to sit beside the heading.
 *
 * The one thing worth saying about the window, and the same thing the weekly
 * board says beside its own heading ("Resets on Sundays"). It replaced the
 * season's date range: a season had to name its ends because it had ends a
 * reader could not guess, while a month is the window you are already in -- so
 * what is left to say is when it turns over, and unlike the week's answer that
 * one changes, which is why it is computed rather than a constant on the page.
 */
export function monthResetLabel(date: string = todayDateString()): string {
  return `Resets ${formatDateLabel(nextMonthStart(date))}`;
}
