/**
 * Congratulating the player who won a window that has closed.
 *
 * The boards themselves say who is *leading* -- rank 1 wears the gold on every
 * one of them, live or closed (see LeaderboardPage). What they never do is
 * point at a result: a week that ended on Saturday is three taps back by
 * Monday, and nobody steps back to a board they were not already on. So once a
 * window has closed and settled, the page says the winner's name out loud, once.
 *
 * Only two windows get it. A day's board turns over every night, and a
 * congratulation every morning is wallpaper; a week and a month are results
 * worth naming. Both open a day *after* the window closes rather than the
 * moment it does, because a board is still moving at the boundary -- a player
 * finishing Saturday's puzzle late on Saturday night writes into a week that
 * has technically ended, and the name congratulated has to be the final one,
 * not the one that happened to be top at midnight.
 *
 * A congratulation is owed to a *player*, not to a day, and a player who did
 * not open the board on the Monday is not a player who wanted no congratulation.
 * So each one stands for four days rather than one, and the visitor who arrives
 * on the Thursday is told the same thing the Monday visitor was. Four and not
 * the whole week, because a result goes stale: by the Friday the board has half
 * a new week on it and last week's winner is old news, said late.
 *
 * What retires it is being popped, which is permanent -- one splat and that
 * window's bubble is gone for good on this device, whatever is left of its four
 * days.
 *
 * Each mode is its own board (see `boardFor` in game/mode.ts), so each closed
 * window has two winners to name, Standard's and Freeform's -- and both are
 * named whichever mode the reader happens to be playing, because a result is
 * news to the whole game, not only to the half of it on the same switch.
 */

import { addDays, todayDateString } from "./date";
import { MODE_CHOICE_START, MODE_LABELS, type GameMode } from "./mode";
import { nextMonthStart, previousMonthStart } from "./month";
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
  /** Which board's winner -- each mode keeps its own (see game/mode.ts). */
  mode: GameMode;
}

const POPPED_PREFIX = "ick:congrats:";

/**
 * The wins `date` still owes a congratulation for, largest first.
 *
 * Four days each. The week's stands from the Monday to the Thursday; the
 * month's from the second to the fifth. Neither opens the moment its window
 * shuts -- not the Sunday, not the first -- because the board underneath is
 * still settling then and the name on top is not yet the final one. And neither
 * outlives its four days: a congratulation arriving on the Friday is a result
 * said late, over a board that is half a new week old.
 *
 * Several can be owed at once, which is what the order is for: the month is
 * the larger result, so it is offered before the week, and within a window
 * Standard -- the game as most people play it -- before Freeform. They come one
 * at a time, each the next to float in once the last has been popped. Two
 * bubbles at the same time is two things to press and a page shouting.
 *
 * Freeform only for a window that reached the split: one that closed before
 * MODE_CHOICE_START had a single board, and its Freeform "winner" would be the
 * Standard one named twice.
 */
export function congratsSpots(date: string = todayDateString()): CongratsSpot[] {
  const windows: { window: CongratsSpot["window"]; start: string; end: string }[] = [];
  // The day of the month, which is a string the date is already written in.
  const day = Number(date.slice(8, 10));
  if (day >= 2 && day <= 5) {
    const start = previousMonthStart(date);
    windows.push({ window: "month", start, end: addDays(nextMonthStart(start), -1) });
  }
  const weekdayOf = weekday(date);
  if (weekdayOf >= 1 && weekdayOf <= 4) {
    // The Sunday *before* this week's: weeks run Sunday to Saturday (see
    // game/week.ts), so on any of these days the week that closed is the one
    // that started eight days before this week's Monday.
    const start = addDays(weekStart(date), -7);
    windows.push({ window: "week", start, end: addDays(start, 6) });
  }
  return windows.flatMap(({ window, start, end }) => {
    const spots: CongratsSpot[] = [{ window, start, mode: "standard" }];
    if (end >= MODE_CHOICE_START) spots.push({ window, start, mode: "freeform" });
    return spots;
  });
}

/**
 * The win to congratulate right now: the largest one that is owed and has not
 * been popped on this browser, or nothing.
 *
 * The popped check belongs *here* rather than at the call site, because it is
 * what decides between them. A player who popped the month's bubble on the
 * second is owed the week's for the rest of the week, and a rule that picked
 * the month and then went quiet when it found it popped would swallow it.
 */
export function pendingCongratsSpot(date: string = todayDateString()): CongratsSpot | null {
  return pendingCongratsSpots(date)[0] ?? null;
}

/** Every win still owed a congratulation on this browser, in the order offered. */
export function pendingCongratsSpots(date: string = todayDateString()): CongratsSpot[] {
  return congratsSpots(date).filter((spot) => !congratsPopped(spot));
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
 * "last" because a month has one. The mode goes on the win itself, since a
 * reader playing the other mode would otherwise take it for their own board.
 */
export function congratsMessage(name: string, spot: CongratsSpot): string {
  const mode = MODE_LABELS[spot.mode];
  if (spot.window === "week") return `Congrats ${name} for last week's ${mode} win`;
  return `Congrats ${name} on ${monthName(spot.start)}'s ${mode} win`;
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

/**
 * Standard keeps the key it had before there were two boards, so a week a player
 * already popped stays popped; Freeform's is namespaced beside it.
 */
function poppedKey(spot: CongratsSpot): string {
  const mode = spot.mode === "standard" ? "" : `${spot.mode}:`;
  return `${POPPED_PREFIX}${mode}${spot.window}:${spot.start}`;
}
