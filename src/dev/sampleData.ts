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
 */
export function sampleBoardsResponse(): unknown {
  return sample;
}
