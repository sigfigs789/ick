import { describe, expect, it } from "vitest";
import type { BoardEntry } from "./leaderboard";
import { topRankIn, TOP_RANK_MIN_PLAYERS } from "./topRank";

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

describe("topRankIn", () => {
  it("is the player's place in the top three of today's board", () => {
    expect(topRankIn(board(15, 1), ME)).toBe(1);
    expect(topRankIn(board(30, 3), ME)).toBe(3);
  });

  it("needs fifteen players on the board", () => {
    expect(TOP_RANK_MIN_PLAYERS).toBe(15);
    expect(topRankIn(board(14, 1), ME)).toBeNull();
  });

  it("is nothing outside the top three, or for a player who has not joined", () => {
    expect(topRankIn(board(15, 4), ME)).toBeNull();
    expect(topRankIn(board(15), ME)).toBeNull();
    expect(topRankIn(board(15, 1), null)).toBeNull();
  });
});
