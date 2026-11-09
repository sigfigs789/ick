/**
 * Everything here works off the player's local calendar date, not UTC --
 * "today's puzzle" should match the date on the player's wall clock, the
 * same way a daily newspaper puzzle does.
 */

export { todayDateString, toDateString } from "./clock";

/** Number of whole days between an epoch date string and a target date string. */
export function daysSinceEpoch(dateStr: string, epochStr: string): number {
  const date = parseDateString(dateStr);
  const epoch = parseDateString(epochStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  // Compare using UTC midnight for both so DST shifts never skew the count.
  const dateUTC = Date.UTC(date.y, date.m - 1, date.d);
  const epochUTC = Date.UTC(epoch.y, epoch.m - 1, epoch.d);
  return Math.round((dateUTC - epochUTC) / msPerDay);
}

/** Adds (or subtracts, for negative values) whole calendar days to a date string. */
export function addDays(dateStr: string, delta: number): string {
  const { y, m, d } = parseDateString(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  // Built and read back via UTC fields throughout so this never drifts a
  // day depending on the host's timezone offset.
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/** The day of the week of a date string, 0 for Sunday through 6 for Saturday. */
export function dayOfWeek(dateStr: string): number {
  const { y, m, d } = parseDateString(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Short display label for a date string, e.g. "Aug 9". */
export function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function parseDateString(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
