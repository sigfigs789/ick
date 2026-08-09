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

function parseDateString(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
