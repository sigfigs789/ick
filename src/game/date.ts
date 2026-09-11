/**
 * Everything here works off the player's local calendar date, not UTC --
 * "today's puzzle" should match the date on the player's wall clock, the
 * same way a daily newspaper puzzle does.
 */

/** Returns today's date as YYYY-MM-DD in the player's local timezone. */
export function todayDateString(): string {
  return toDateString(new Date());
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

/** Short display label for a date string, e.g. "Aug 9". */
export function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The weekday a date fell on, spelled out: "Monday".
 *
 * For labelling a day inside the last week, where the name is the half a reader
 * can place without counting -- "Monday's champion" lands where "Sep 14's
 * champion" is a date you have to go and work out. Only safe inside a week, and
 * only used there: a weekday repeats every seven days, so anything further back
 * gets its date instead (see formatDateLabel).
 *
 * Spelled out rather than "Mon", to match the boards' own "Resets on Sundays"
 * and "Resets Thursday, Oct 1" -- three notes on one page, and one abbreviating
 * what the others spell reads as a different kind of label.
 */
export function weekdayName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
  });
}

/**
 * The name of the calendar month before the one `dateStr` falls in, e.g.
 * "July" for any day in August.
 *
 * Named rather than dated because it labels a champion: "July's champion" is a
 * thing a reader places instantly, where "Jul 1 - Jul 31" is a range they have
 * to read. Derived from the player's own puzzle date, which is the same date the
 * server bounds that champion's window with, so the two always name one month.
 */
export function previousMonthName(dateStr: string): string {
  const { y, m } = parseDateString(dateStr);
  // Day 0 of this month is the last day of the one before it, so the month rolls
  // back through January without any wrapping of its own.
  return new Date(y, m - 1, 0).toLocaleDateString(undefined, { month: "long" });
}

function parseDateString(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
