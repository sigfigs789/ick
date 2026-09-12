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
 * the week ever stops starting on Sunday, that test is what will say so.
 */

/** The Sunday on or before `date`, as YYYY-MM-DD. */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  // Built and read through UTC fields so the host's offset can never shift the
  // weekday by a day -- the same reason the game's own copy does it this way.
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return isoDate(dt);
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

/** The Saturday closing the week that `start` opens. */
export function weekEndOf(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + 6);
  return isoDate(dt);
}

function isoDate(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}
