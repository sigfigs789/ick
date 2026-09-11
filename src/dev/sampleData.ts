/**
 * A "use sample data" switch for the leaderboard, for development only.
 *
 * The leaderboard is the one part of this game that cannot be exercised offline
 * -- it needs other players -- which made it the one part you could not look at
 * without standing up a database. This is the answer to that: a hardcoded
 * fixture in the response's own shape, switched on from the page itself.
 *
 * Every export here is guarded by `import.meta.env.DEV`, so in a production
 * build the checks fold to `false`, this module's branches are dropped, and the
 * fixture JSON is never pulled into the bundle. The dev-only "Reset answers"
 * button in App.tsx works the same way.
 */

import sample from "./sample-leaderboard.json";
import { addDays, daysSinceEpoch, todayDateString } from "../game/date";
import { loadPlayerId } from "../game/player";

const SAMPLE_KEY = "ick:dev-sample-leaderboard";

/** Whether sample data is standing in for the server right now. */
export function usingSampleData(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(SAMPLE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn the sample data on or off. Remembered, so a reload keeps it. */
export function setUsingSampleData(on: boolean): void {
  if (!import.meta.env.DEV) return;
  try {
    if (on) localStorage.setItem(SAMPLE_KEY, "1");
    else localStorage.removeItem(SAMPLE_KEY);
  } catch {
    // Storage unavailable; the toggle simply won't persist.
  }
}

/**
 * The fixture, in the exact shape /api/leaderboard answers with -- so it is
 * parsed by the same code that parses a real response, and a change to that
 * parsing cannot pass here and fail in production.
 *
 * The finds are dated forward so the newest lands on today, which is the whole
 * point of sample data: a fixture frozen at the dates it was written would show
 * a week of history and never the live "Today" group, so the one behaviour most
 * worth looking at would be the one it could not demonstrate.
 */
export function sampleBoardsResponse(): unknown {
  const words = sample.words as { foundOn: string }[];
  const newest = words.reduce((latest, w) => (w.foundOn > latest ? w.foundOn : latest), "");
  const shift = newest ? daysSinceEpoch(todayDateString(), newest) : 0;
  return {
    ...sample,
    daily: asPlayer(sample.daily),
    dailySelf: asPlayer(sample.dailySelf),
    weekly: asPlayer(sample.weekly),
    weeklySelf: asPlayer(sample.weeklySelf),
    allTime: asPlayer(sample.allTime),
    allTimeSelf: asPlayer(sample.allTimeSelf),
    words: words.map((word) => ({ ...word, foundOn: addDays(word.foundOn, shift) })),
  };
}

/**
 * The id the fixture uses for "you", which is nobody until it is somebody.
 *
 * The page decides which row is yours by comparing ids (`playerId === entry.
 * playerId`), so a fixture row with a made-up id is a row about a stranger --
 * it renders with no "you" beside the name and none of the treatment that
 * follows from it. Which made the one thing the fixture most needed to show,
 * a player seeing themselves on a board, the one thing it could not.
 */
const FIXTURE_SELF = "dev-you";

/**
 * Hand the fixture's own player this browser's real id, so the boards can
 * recognise them.
 *
 * The name changes with it -- handles are derived from the id (game/handle.ts),
 * so "you" in the fixture is called whatever this browser is called rather than
 * SunnyLily55. That is the point: it is the same row the real server would send
 * back about you, under the name the rest of the app already uses for you.
 *
 * Left alone when nobody has joined on this browser, which is a state worth
 * being able to look at too.
 */
function asPlayer<T>(rows: T): T {
  const playerId = loadPlayerId();
  if (!playerId) return rows;
  const swap = (row: unknown): unknown =>
    row && typeof row === "object" && (row as { playerId?: unknown }).playerId === FIXTURE_SELF
      ? { ...(row as object), playerId }
      : row;
  return (Array.isArray(rows) ? rows.map(swap) : swap(rows)) as T;
}
