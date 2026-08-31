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

/*
 * There is no countdown here any more, and no way to name a week's dates.
 *
 * The page said "From Sunday on. Resets in 5 days.", then briefly carried the
 * week's own days beside the heading. Both were answering a question nobody
 * brought: a week is the window you are already in, and "this week" is the whole
 * of what anybody needs to know about which days it counts. What is worth saying
 * once is when it turns over, and that is the same sentence every day of the
 * week -- "Resets on Sundays." -- so it is a constant on the page rather than
 * anything computed here. The monthly board says the same thing about itself,
 * except that its answer is a date and so has to be computed (see
 * game/month.ts).
 */

/** Days from the week's Sunday to `date`: 0 on Sunday, 6 on Saturday. */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Whether last week's champion is still settling -- true on Sunday, false the
 * rest of the week.
 *
 * The plaque under the weekly board names the winner of the seven days before
 * this window, and that window closes at a different moment for every player,
 * because it closes at their own midnight (see the note at the top of this
 * file). A player in Tokyo reaches Sunday roughly twenty hours before the last
 * player in American Samoa finishes Saturday -- so a name shown on Sunday is a
 * name that can still change under the reader, and a plaque that changes its
 * mind is worse than one that has not spoken yet.
 *
 * So the whole of Sunday is held: the plaque says when it will be engraved
 * instead of guessing at whom. By Monday every clock on earth has left Saturday
 * and the answer is the same everywhere, which is the property a plaque needs
 * and a live board does not.
 *
 * Nothing about the underlying result changes here -- the champion is computed
 * the same way whenever it is read, and whoever won still won. This decides only
 * whether it is safe to say so yet.
 */
export function weekChampionSettling(
  date: string = todayDateString(),
): boolean {
  // Sunday is the one day that is its own week's start.
  return weekStart(date) === date;
}

/**
 * The Sunday of the week whose champion the next crowning will name.
 *
 * The empty plaque says which window it is waiting on, and that window is not
 * always the one the board just left. On the settling day the crowning about to
 * happen is for the week that closed this morning, so it is a week back; on any
 * other day that week has already been crowned -- or went unwon and never will
 * be -- and the next name in the box comes from the week being played now.
 *
 * Derived from the day and not from whether a champion exists, which is what
 * keeps the plaque from answering "did anybody win this" while that is still
 * settling (see `weekChampionSettling`).
 */
export function crowningWeekStart(date: string = todayDateString()): string {
  const start = weekStart(date);
  return weekChampionSettling(date) ? addDays(start, -7) : start;
}
