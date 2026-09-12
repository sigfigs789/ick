/**
 * Everything here works off the player's local calendar date, not UTC --
 * "today's puzzle" should match the date on the player's wall clock, the
 * same way a daily newspaper puzzle does.
 */

/**
 * The puzzle day a host has fixed, or null when the wall clock decides.
 *
 * Null everywhere on this site, and there is no code path here that sets it.
 * It exists for a host where "today" is not a question about the player's
 * clock: on Reddit the game is played inside a post, one post is one puzzle,
 * and a player opening Tuesday's post on Friday is on Tuesday's puzzle. There
 * the day is a property of where you are, not of when you are.
 */
let fixedPuzzleDay: string | null = null;

/**
 * Fix the day, for a host that knows which puzzle the player is on.
 *
 * Deliberately reaches every caller of `todayDateString` rather than only the
 * one that picks the drop. "Today" has to mean one thing at a time: the drop,
 * the progress key, the streak, the board windows and the finds feed are all
 * scoped to the day being played, and a game whose puzzle came from the post
 * while its leaderboard window came from the clock would be two games.
 *
 * Must be called before anything renders -- the day is read during render, and
 * a change afterwards would not reach a component that has already read it.
 *
 * Passing null hands the day back to the clock, which is what every test that
 * touches this does when it finishes.
 */
export function setPuzzleDay(date: string | null): void {
  fixedPuzzleDay = date;
}

/**
 * Today's date as YYYY-MM-DD -- the player's local calendar date, unless a host
 * has fixed the puzzle day (see `setPuzzleDay`).
 */
export function todayDateString(): string {
  return fixedPuzzleDay ?? toDateString(new Date());
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

function parseDateString(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
