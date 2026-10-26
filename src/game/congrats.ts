/**
 * Congratulating the player who won a window that has closed.
 *
 * The boards themselves say who is *leading* -- rank 1 wears the gold on every
 * one of them, live or closed (see LeaderboardPage). What they never do is
 * point at a result: a week that ended on Sunday is three taps back by
 * Tuesday, and nobody steps back to a board they were not already on. So once a
 * window has closed and settled, the page says the winner's name out loud, once.
 *
 * Only two windows get it. A day's board turns over every night, and a
 * congratulation every morning is wallpaper; a week and a month are results
 * worth naming. Both open a day *after* the window closes rather than the
 * moment it does, because a board is still moving at the boundary -- a player
 * finishing Sunday's puzzle late on Sunday night writes into a week that
 * has technically ended, and the name congratulated has to be the final one,
 * not the one that happened to be top at midnight.
 *
 * A congratulation is owed to a *player*, not to a day, and a player who did
 * not open the board on the Tuesday is not a player who wanted no congratulation.
 * So each one stands for four days rather than one, and the visitor who arrives
 * on the Friday is told the same thing the Tuesday visitor was. Four and not
 * the whole week, because a result goes stale: by the Saturday the board has half
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

import { addDays, daysSinceEpoch, todayDateString } from "./date";
import { MODE_CHOICE_START, MODE_LABELS, type GameMode } from "./mode";
import { nextMonthStart, previousMonthStart } from "./month";
import { playedBefore } from "./storage";
import { previousWeek, weekEnd, weekStart } from "./week";

/** A window that has closed and is worth naming a winner for. */
export interface CongratsSpot {
  window: "week" | "month";
  /**
   * The near end of the closed window -- the day its week started on (see
   * game/week.ts), or its first. The same shape the boards are asked for (see game/leaderboard.ts),
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
 * Four days each. The week's stands from the second to the fifth day of the
 * next week -- Tuesday to Friday, now weeks run Monday to Sunday (see
 * game/week.ts) -- and the month's from the second to the fifth of the next
 * month. Neither opens the moment its window shuts -- not the Monday, not the
 * first -- because the board underneath is still settling then and the name on
 * top is not yet the final one. And neither outlives its four days: a
 * congratulation arriving on the Saturday is a result said late, over a board
 * that is half a new week old.
 *
 * The last Sunday week, which closed on Saturday 2026-10-24, is named Monday to
 * Thursday as the Sunday weeks were: the week after it starts on the Sunday the
 * move to Monday weeks left over, so its second day is the Monday.
 *
 * Several can be owed at once, and they all float at once. The order is the
 * month before the week, the larger result, and within a window Standard --
 * the game as most people play it -- before Freeform.
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
  const thisWeek = weekStart(date);
  const intoWeek = daysSinceEpoch(date, thisWeek);
  if (intoWeek >= 1 && intoWeek <= 4) {
    // The week before this one, whichever day weeks start on (see game/week.ts).
    const start = previousWeek(thisWeek);
    windows.push({ window: "week", start, end: weekEnd(start) });
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

/**
 * Every win still owed a congratulation on this browser, in the order offered.
 *
 * A month's win only for a player who was around for that month -- one who
 * banked a word on a puzzle dated in it or before it. To somebody who arrived
 * on the second, last month's champion is a stranger's result from before they
 * knew the game, and four bubbles over the boards on a first look is a page
 * shouting about nothing they took part in. The week's is short enough to be
 * news to anybody, so it is not held back.
 */
export function pendingCongratsSpots(date: string = todayDateString()): CongratsSpot[] {
  return congratsSpots(date).filter(
    (spot) =>
      !congratsPopped(spot) &&
      (spot.window !== "month" || playedBefore(nextMonthStart(spot.start))),
  );
}

/**
 * How many players a closed board needs before its winner is named.
 *
 * Freeform's week is the thin one: a board of two or three is not a field
 * anybody beat, and "Congrats" over it congratulates turning up. So a Freeform
 * week names nobody under five. Every other board needs only somebody on it,
 * since a window nobody scored in has no winner either way.
 */
export const FREEFORM_WEEK_MIN_PLAYERS = 5;

export function congratsMinPlayers(spot: CongratsSpot): number {
  return spot.mode === "freeform" && spot.window === "week" ? FREEFORM_WEEK_MIN_PLAYERS : 1;
}

/** One stop on a bubble's wander, as shares of the room it has. */
export interface WanderStop {
  /** -1 is the far left the bubble fits at, 1 the far right, 0 the middle. */
  x: number;
  /** 0 is the top of the boards, 1 as far down as the bubble fits. */
  y: number;
}

/** How many stops a wander makes before it comes back round to the first. */
const WANDER_STOPS = 5;

/**
 * A fresh wander for one bubble: where it spawns, then where it drifts.
 *
 * Random per bubble, so the ones owed together spawn in different places and
 * drift on different paths rather than stacked on one spot walking in step.
 * Each stop is a share of the room rather than a position, so both front-ends
 * can spend it against their own layout and no stop can be off the board.
 */
export function wanderPath(random: () => number = Math.random): WanderStop[] {
  return Array.from({ length: WANDER_STOPS }, () => ({
    x: random() * 2 - 1,
    y: random(),
  }));
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

/**
 * What the bubble says when the winner is the reader.
 *
 * "Congrats mo for last week's win" read by mo is the game congratulating them
 * in the third person, as if it had not noticed who was looking. Their own win
 * gets said to them: the headline is the one fact, and the detail says which
 * board, in the same words the message above uses for everybody else.
 */
export function selfCongratsMessage(spot: CongratsSpot): { headline: string; detail: string } {
  const mode = MODE_LABELS[spot.mode];
  const window = spot.window === "week" ? "last week's" : `${monthName(spot.start)}'s`;
  return { headline: "You won!", detail: `Top of ${window} ${mode} board` };
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
