/**
 * The server's window helpers are a copy of the game's. This is what keeps the
 * copy honest.
 *
 * It lives here but runs in the repo's own vitest suite rather than the
 * template's node test runner, because it is the one test that has to import
 * both sides at once -- the Devvit server's copy and the game's original. Run
 * it with `npm test` from the repo root.
 */

import { describe, expect, it } from "vitest";
import { monthStart } from "../../src/game/month";
import { weekEnd, weekStart } from "../../src/game/week";
import { monthEndOf, monthStartOf, weekEndOf, weekStartOf } from "../src/shared/windows";

/** Every date across a span wide enough to cover leap years and month ends. */
function everyDateFrom(start: string, days: number): string[] {
  const [y, m, d] = start.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return Array.from({ length: days }, () => {
    const iso = dt.toISOString().slice(0, 10);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return iso;
  });
}

// Four years from before the game's epoch, so the span crosses two leap years,
// every month length, and every weekday alignment of the first of a month.
const DATES = everyDateFrom("2025-01-01", 4 * 366);

describe("the server's copy of the game's windows", () => {
  it("starts a week on the same day the game does", () => {
    for (const date of DATES) {
      expect(weekStartOf(date), date).toBe(weekStart(date));
    }
  });

  it("closes a week on the same day the game does", () => {
    for (const date of DATES) {
      const start = weekStart(date);
      expect(weekEndOf(start), start).toBe(weekEnd(start));
    }
  });

  it("starts a month on the same day the game does", () => {
    for (const date of DATES) {
      expect(monthStartOf(date), date).toBe(monthStart(date));
    }
  });

  it("closes a month on its own last day", () => {
    // The game has no monthEnd of its own -- the website's endpoint derives it
    // (api/leaderboard.ts) and so does this one. Checked against the property
    // that defines it rather than against a second implementation: the day
    // after the month's end is the first of the next month.
    for (const date of DATES) {
      const start = monthStartOf(date);
      const end = monthEndOf(start);
      const dayAfter = new Date(`${end}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      expect(dayAfter.toISOString().slice(0, 10), start).toBe(
        monthStartOf(dayAfter.toISOString().slice(0, 10)),
      );
      expect(end.slice(0, 7), start).toBe(start.slice(0, 7));
    }
  });
});
