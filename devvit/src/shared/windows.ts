/**
 * The two windows the boards aggregate over, on the server's side of the wire.
 *
 * These are deliberate copies of `src/game/week.ts` and `src/game/month.ts`
 * rather than imports of them. The server compiles under its own `rootDir`, so
 * reaching up into the game's source would either break `tsc --build` or force
 * the whole repo into this project's TypeScript graph -- a large change to buy
 * two small functions.
 *
 * The copy is pinned rather than trusted: `windows.test.ts` walks several years
 * of dates through both implementations and fails the moment they disagree. If
 * the day a week starts on ever changes again, that test is what will say so.
 */

/**
 * The first day of the first Monday week. Weeks ran Sunday to Saturday before
 * it; that week also took in the Sunday the change left over, so it starts on
 * that Sunday and runs eight days.
 */
const MONDAY_WEEKS_START = '2026-10-25';

/**
 * The day the week `date` falls in starts on, as YYYY-MM-DD: the Monday on or
 * before it, or before MONDAY_WEEKS_START the Sunday -- and for the first Monday
 * week, MONDAY_WEEKS_START itself.
 */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  // Built and read through UTC fields so the host's offset can never shift the
  // weekday by a day -- the same reason the game's own copy does it this way.
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (date < MONDAY_WEEKS_START) {
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    return isoDate(dt);
  }
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  const monday = isoDate(dt);
  return monday <= '2026-10-26' ? MONDAY_WEEKS_START : monday;
}

/** The first of the month `date` falls in, as YYYY-MM-DD. */
export function monthStartOf(date: string): string {
  // Slicing rather than arithmetic: the first of the month is already written
  // in the date it comes from, so there is nothing here to get wrong.
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month that `start` opens, bounding it at the far end. */
export function monthEndOf(start: string): string {
  const [y, m] = start.split('-').map(Number);
  // Day zero of the next month is the last day of this one: no table of month
  // lengths, and no leap-year case.
  return isoDate(new Date(Date.UTC(y!, m!, 0)));
}

/** The last day of the week that `start` opens: six days on, or seven for the first Monday week. */
export function weekEndOf(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + (start === MONDAY_WEEKS_START ? 7 : 6));
  return isoDate(dt);
}

function isoDate(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/**
 * How far behind UTC the game's own day runs.
 *
 * Ten hours, which is Hawaii -- the westernmost timezone this game has players
 * in. See `gameDay` for why it is the west that decides.
 */
const GAME_DAY_OFFSET_HOURS = 10;

/**
 * The date a post created right now should hold.
 *
 * Not UTC's date, which is the bug this replaced: a server computing "today" in
 * UTC is already on tomorrow for everybody west of it, so a player in Hawaii
 * opening the day's post at four in the afternoon was handed a puzzle dated the
 * twelfth while their own device said the eleventh. Ten hours of every day, the
 * post was a day they had not reached.
 *
 * The asymmetry is the whole of the reasoning. A post a day *behind* a player is
 * harmless -- they have played that day, the puzzle is real, and a late puzzle is
 * still a puzzle. A post a day *ahead* is nonsense: the date has not happened,
 * and on the website it is a day they could not have played. So the date to
 * publish is the one that has already arrived in the westernmost place anybody
 * plays from, and everywhere further east is at most a few hours behind it.
 *
 * Computed from the offset rather than taken from a clock at posting time, so it
 * is the same answer whether the schedule asks, an install asks, or a moderator
 * asks at some unplanned hour of the night.
 */
export function gameDay(now: Date = new Date()): string {
  return new Date(now.getTime() - GAME_DAY_OFFSET_HOURS * 3600_000)
    .toISOString()
    .slice(0, 10);
}
