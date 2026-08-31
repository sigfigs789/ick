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

import { todayDateString } from "./date";

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
 * `Resets Tuesday, Sep 1`, to sit beside the heading.
 *
 * The one thing worth saying about the window, and the same thing the weekly
 * board says beside its own heading ("Resets on Sundays"). It replaced the
 * season's date range: a season had to name its ends because it had ends a
 * reader could not guess, while a month is the window you are already in -- so
 * what is left to say is when it turns over, and unlike the week's answer that
 * one changes, which is why it is computed rather than a constant on the page.
 *
 * The weekday leads, because it is the half of the answer a player can act on.
 * "Sep 1" is a date you have to go and place -- somebody reading this on a
 * Thursday cannot tell from it whether they have a weekend of play left or one
 * more evening. The weekday is the whole of what the date was for, so it goes
 * first and the date follows as the confirmation, which is also the order the
 * weekly board's "Resets on Sundays" already reads in.
 */
export function monthResetLabel(date: string = todayDateString()): string {
  const reset = nextMonthStart(date);
  // Spelled out rather than "Tue", to match the weekly board's own "Sundays" --
  // the two notes sit side by side, and one abbreviating what the other spells
  // reads as two different labels rather than the same one twice.
  const weekday = new Date(`${reset}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
  });
  return `Resets ${weekday}, ${monthDayLabel(reset)}`;
}

/**
 * `Sep 1`, the short form every date on this page is written in.
 *
 * Not `formatDateLabel`, which is the same thing built by a locale's own
 * month/day ordering: this one shares a phrase with a weekday now, and a locale
 * that would render the date as "1 Sep" would make the phrase read "Resets
 * Tuesday, 1 Sep" against the "Sep 1" the rest of the page uses.
 */
function monthDayLabel(date: string): string {
  const month = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
  });
  return `${month} ${Number(date.slice(8, 10))}`;
}

/**
 * Whether last month's champion is still settling -- true on the first, false
 * the rest of the month.
 *
 * Exactly the weekly board's problem, one window up: the month closes at each
 * player's own midnight, so on the first the plaque under this board is naming a
 * winner that players a day behind can still displace. See
 * `weekChampionSettling` in game/week.ts for the reasoning; the only difference
 * is which boundary is being crossed, and so which day carries the caveat.
 */
export function monthChampionSettling(
  date: string = todayDateString(),
): boolean {
  // The first is the one day that is its own month's start.
  return monthStart(date) === date;
}
