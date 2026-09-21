/**
 * Congratulating the player who won a window that has closed.
 *
 * The boards themselves say who is *leading* -- rank 1 wears the gold on every
 * one of them, live or closed (see LeaderboardPage). What they never do is
 * point at a result: a week that ended on Saturday is three taps back by
 * Tuesday, and nobody steps back to a board they were not already on. So once a
 * window has closed and settled, the page says the winner's name out loud, once.
 *
 * Only two windows get it. A day's board turns over every night, and a
 * congratulation every morning is wallpaper; a week and a month are results
 * worth naming. Both are named a day or two *after* the window closes rather
 * than the moment it does, because a board is still moving at the boundary --
 * a player finishing Saturday's puzzle late on Saturday night writes into a
 * week that has technically ended, and the name congratulated has to be the
 * final one, not the one that happened to be top at midnight.
 */

import { addDays, todayDateString } from "./date";
import { previousMonthStart } from "./month";
import { weekStart } from "./week";

/** A window that has closed and is worth naming a winner for. */
export interface CongratsSpot {
  window: "week" | "month";
  /**
   * The near end of the closed window -- the Sunday it started on, or its
   * first. The same shape the boards are asked for (see game/leaderboard.ts),
   * so it goes straight into a request.
   */
  start: string;
}

const POPPED_PREFIX = "ick:congrats:";

/**
 * Which win, if any, `date` is the day to congratulate.
 *
 * Tuesday for the week, the second for the month: one clear day after the
 * window closed, so the board underneath has stopped moving and the name is
 * final. It is also the day somebody is back playing rather than the day they
 * were finishing the old window, which is the difference between a result and
 * a running score.
 *
 * The month wins when the second falls on a Tuesday, which it does a couple of
 * times a year. Two bubbles at once is two things to press and a page shouting;
 * of the pair the month is the larger result and the rarer one, and the week's
 * loss is a single congratulation that never appeared -- the weekly board's own
 * gold still says who won it.
 */
export function congratsSpot(date: string = todayDateString()): CongratsSpot | null {
  // The second of the month, which is a string the date is already written in.
  if (date.slice(8, 10) === "02") {
    return { window: "month", start: previousMonthStart(date) };
  }
  if (weekday(date) === 2) {
    // The Sunday *before* this week's: weeks run Sunday to Saturday (see
    // game/week.ts), so on a Tuesday the week that closed started nine days ago.
    return { window: "week", start: addDays(weekStart(date), -7) };
  }
  return null;
}

/**
 * The weekday of a calendar date, 0 on Sunday -- read off a UTC-midnight date
 * so no host timezone offset can shift it a day, exactly as game/week.ts reads
 * its own.
 */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * What the bubble says.
 *
 * The name first after the one word that matters, because that is what a reader
 * is scanning for -- their own handle, or the one they have been racing. The
 * window comes second and is named the way the reader already thinks of it:
 * "last week's", which needs no dates, and the month by name, which needs no
 * "last" because a month has one.
 */
export function congratsMessage(name: string, spot: CongratsSpot): string {
  if (spot.window === "week") return `Congrats ${name} for last week's win`;
  return `Congrats ${name} on ${monthName(spot.start)}'s win`;
}

/** `September`, for the month a closed monthly window covers. */
function monthName(start: string): string {
  return new Date(`${start}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
  });
}

/**
 * Whether this window's bubble has already been popped.
 *
 * One bit per window, so popping it on the phone at breakfast does not mean
 * seeing it again at lunch -- and so a window whose bubble was popped can never
 * come back, however many times the page is opened on the day.
 *
 * Storage that cannot be read at all reports *popped*, the same way the app's
 * other one-time markers do (see game/whatsNew.ts): a browser with no way to
 * remember the press should show no bubble rather than an unpoppable one on
 * every load.
 */
export function congratsPopped(spot: CongratsSpot): boolean {
  try {
    return localStorage.getItem(poppedKey(spot)) !== null;
  } catch {
    return true;
  }
}

/** Retire this window's bubble, for good. */
export function markCongratsPopped(spot: CongratsSpot): void {
  try {
    localStorage.setItem(poppedKey(spot), "1");
  } catch {
    // A store that cannot be written is one `congratsPopped` cannot read
    // either, so no bubble was drawn to begin with.
  }
}

function poppedKey(spot: CongratsSpot): string {
  return `${POPPED_PREFIX}${spot.window}:${spot.start}`;
}
