/**
 * The weekly board's window.
 *
 * Weeks run **Monday to Sunday** on the player's own wall clock, the same local
 * calendar the puzzle date itself comes from (see game/date.ts). They ran Sunday
 * to Saturday until MONDAY_WEEKS_START; the week ending that Saturday, 2026-10-24,
 * was the last of those.
 *
 * Monday so the weekend is the end of one week, the same week the lazy weekend
 * is earned in (see game/streakFreeze.ts): the board and the rest days agree on
 * which days make a week. Sunday weeks were chosen for onboarding -- a Sunday
 * reset put one weekend day on a fresh board -- and that is what Monday gives up.
 *
 * The change left one Sunday over: 2026-10-25, the day after the last Sunday
 * week closed and the day before the first Monday one opened. It is not a week of
 * its own. The first Monday week takes it in, so that week runs eight days,
 * Sunday 2026-10-25 to Sunday 2026-11-01, and starts on that Sunday.
 *
 * Nothing is archived or deleted when a week turns over: the board is always
 * "scores from this week's first day onward", so the reset is a window moving
 * rather than a job that runs -- there is nothing to fail at midnight. The window
 * is computed here and passed to the query, so no SQL knows which day a week
 * starts on.
 *
 * Local rather than UTC because a reset should land at the player's midnight, not
 * at someone else's. The cost is that two players in different timezones can
 * briefly see slightly different weekly boards around the boundary, which is the
 * same harmless drift the daily puzzle already has.
 */

import { addDays, dayOfWeek, formatDateLabel, todayDateString } from "./date";

/**
 * How many of a week's seven days its total counts: each player's best four.
 *
 * Summing every day made the weekly board a test of attendance first -- one
 * missed day was a whole puzzle down on everybody who played it. Four leaves
 * room for three days off, and a fifth, sixth or seventh day still helps by
 * replacing a worse one. The board's own copy of this number is in the database
 * (20261006120000_leaderboard_week_best_four.sql), which cannot import it; the
 * client reads this one so a shared week total agrees with the board.
 */
export const WEEK_BEST_DAYS = 4;

/**
 * The first day of the first Monday week: the Sunday the change left over,
 * which that week takes in. Weeks before it ran Sunday to Saturday.
 */
export const MONDAY_WEEKS_START = "2026-10-25";

/**
 * The day the week `date` falls in starts on, as YYYY-MM-DD: the Monday on or
 * before it, or before MONDAY_WEEKS_START the Sunday -- and for the first Monday
 * week, MONDAY_WEEKS_START itself.
 */
export function weekStart(date: string = todayDateString()): string {
  // dayOfWeek reads the weekday of the calendar date itself, with no chance of a
  // host timezone offset shifting it a day. 0 is Sunday.
  if (date < MONDAY_WEEKS_START) return addDays(date, -dayOfWeek(date));
  const monday = addDays(date, -((dayOfWeek(date) + 6) % 7));
  return monday <= addDays(MONDAY_WEEKS_START, 1) ? MONDAY_WEEKS_START : monday;
}

/*
 * There is no countdown here any more, and no way to name a week's dates.
 *
 * The page said "From Sunday on. Resets in 5 days.", then briefly carried the
 * week's own days beside the heading. Both were answering a question nobody
 * brought: a week is the window you are already in, and "this week" is the whole
 * of what anybody needs to know about which days it counts. What is worth saying
 * once is when it turns over, and that is the same sentence every day of the
 * week -- "Resets on Mondays." -- so it is nearly a constant. The monthly board
 * says the same thing about itself, except that its answer is a date and so has
 * to be computed (see game/month.ts).
 */

/**
 * What the weekly board says beside its heading on `today`: when the live week
 * turns over. Sundays until the last Sunday week closes, then Mondays.
 */
export function weekResetLabel(today: string = todayDateString()): string {
  return today < MONDAY_WEEKS_START ? "Resets on Sundays" : "Resets on Mondays";
}

/**
 * The last day of the week starting on `start`: six days on, or seven for the
 * first Monday week, which took in the Sunday before it.
 */
export function weekEnd(start: string): string {
  return addDays(start, start === MONDAY_WEEKS_START ? 7 : 6);
}

/** The start of the week before the one starting on `start`. */
export function previousWeek(start: string): string {
  return weekStart(addDays(start, -1));
}

/** The start of the week after the one starting on `start`. */
export function nextWeek(start: string): string {
  return addDays(weekEnd(start), 1);
}

/**
 * `Week of Aug 16`, for a weekly board showing a window the reader has stepped
 * back to.
 *
 * The first day alone, not the pair of dates it runs between. A week is seven
 * days from its first everywhere in this game, so naming both ends spells out the
 * half a reader can already do -- and the heading it sits in is set in the
 * display face at fifteen characters wide, where "Aug 16 - Aug 22" wraps and
 * "Week of Aug 16" does not. The live board says "This week" in the same slot,
 * which is the same sentence with the date left out because it is today's.
 */
export function weekLabel(start: string): string {
  return `Week of ${formatDateLabel(start)}`;
}
