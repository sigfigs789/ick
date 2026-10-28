import { beforeEach, describe, expect, it } from "vitest";
import type { BoardEntry } from "./leaderboard";
import {
  markTopRankCelebrated,
  topRankCelebrationDue,
  topRankIn,
  TOP_RANK_MIN_PLAYERS,
} from "./topRank";

const ME = "me";

/** A board of `size` players, with `ME` at `rank` (or nowhere). */
function board(size: number, rank: number | null = null): BoardEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    rank: i + 1,
    playerId: i + 1 === rank ? ME : `p${i}`,
    name: "",
    windowWord: "",
    windowScore: 0,
    score: 0,
    puzzles: 1,
  }));
}

const FULL = TOP_RANK_MIN_PLAYERS;

describe("topRankIn", () => {
  it("prefers the monthly board, then the weekly, then the daily", () => {
    expect(topRankIn({ monthly: board(FULL, 3), weekly: board(FULL, 1), daily: board(FULL, 1) }, ME)).toEqual({
      board: "monthly",
      rank: 3,
    });
    expect(topRankIn({ monthly: board(FULL, 4), weekly: board(FULL, 2), daily: board(FULL, 1) }, ME)).toEqual({
      board: "weekly",
      rank: 2,
    });
    expect(topRankIn({ monthly: board(FULL), weekly: board(FULL), daily: board(FULL, 1) }, ME)).toEqual({
      board: "daily",
      rank: 1,
    });
  });

  it("needs twenty players on the board", () => {
    expect(TOP_RANK_MIN_PLAYERS).toBe(20);
    expect(topRankIn({ monthly: board(19, 1), weekly: board(FULL, 3), daily: board(FULL) }, ME)).toEqual({
      board: "weekly",
      rank: 3,
    });
    expect(topRankIn({ monthly: board(19, 1), weekly: board(19, 1), daily: board(19, 1) }, ME)).toBeNull();
  });

  it("is nothing outside the top three, or for a player who has not joined", () => {
    expect(topRankIn({ monthly: board(FULL, 4), weekly: board(FULL), daily: board(FULL) }, ME)).toBeNull();
    expect(topRankIn({ monthly: board(FULL, 1), weekly: board(FULL), daily: board(FULL) }, null)).toBeNull();
  });
});

describe("topRankCelebrationDue", () => {
  beforeEach(() => localStorage.clear());

  it("comes due a week after the last card", () => {
    expect(topRankCelebrationDue("2026-10-28")).toBe(true);
    markTopRankCelebrated("2026-10-28");
    expect(topRankCelebrationDue("2026-10-28")).toBe(false);
    expect(topRankCelebrationDue("2026-11-03")).toBe(false);
    expect(topRankCelebrationDue("2026-11-04")).toBe(true);
  });
});
