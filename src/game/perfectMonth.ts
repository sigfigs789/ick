/**
 * A perfect month: every puzzle of a calendar month played on its own day.
 *
 * Read straight off the streak rather than kept as a record of its own. The
 * streak already is the answer -- it counts consecutive days ending on
 * `lastCompletedDate`, and it only ever advances on today's puzzle (see
 * storage.updateStreakOnValidAnswer), never out of the archive. So on the last
 * day of a month, a streak that reaches back to the first is a month with no
 * day missing, and nothing new has to be stored, migrated or transferred.
 *
 * "Played" means what it means everywhere else in this game: the day's first
 * accepted word, which is the moment the streak banks. A player does not have
 * to spend every guess or lock in to have played the day.
 *
 * Only the last day can finish a month, so the celebration lands once, on the
 * guess that completes it -- not on the first, where the month it would name
 * is already over, and not on any day before, where it is still unearned.
 */

import { addDays } from "./date";
import { nextMonthStart } from "./month";
import type { StreakState } from "./types";

/** Whether `date`'s puzzle is the one that closed a month with no day missed. */
export function completedWholeMonth(streak: StreakState, date: string): boolean {
  if (streak.lastCompletedDate !== date) return false;
  if (addDays(date, 1) !== nextMonthStart(date)) return false;
  // The day of the month is the month's length on its last day.
  return streak.currentStreak >= Number(date.slice(8, 10));
}

/** `September`, for the month `date` falls in. */
export function perfectMonthName(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "long" });
}
