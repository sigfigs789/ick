import { describe, expect, it } from "vitest";
import { beatBestToday, bestToBeat } from "./newBest";
import type { StreakState } from "./types";

const TODAY = "2026-10-31";

function streak(overrides: Partial<StreakState>): StreakState {
  return {
    currentStreak: 0,
    longestStreak: 0,
    totalCompleted: 0,
    crushedIt: 0,
    elite: 0,
    highScore: 0,
    ...overrides,
  };
}

describe("bestToBeat", () => {
  it("gives a new streak the best so far, and a first ever streak nothing", () => {
    expect(bestToBeat(streak({ currentStreak: 0, longestStreak: 9 }), false)).toBe(9);
    expect(bestToBeat(streak({}), false)).toBe(0);
  });

  it("keeps what a streak carrying on started with", () => {
    expect(bestToBeat(streak({ currentStreak: 10, longestStreak: 10, bestToBeat: 9 }), true)).toBe(9);
  });

  it("guesses for a save from before it was kept", () => {
    expect(bestToBeat(streak({ currentStreak: 7, longestStreak: 9 }), true)).toBe(9);
    expect(bestToBeat(streak({ currentStreak: 9, longestStreak: 9 }), true)).toBe(0);
  });
});

describe("beatBestToday", () => {
  const played = { lastCompletedDate: TODAY, bestToBeat: 9 };

  it("is the best passed on the day the streak first goes above it", () => {
    expect(beatBestToday(streak({ ...played, currentStreak: 10, longestStreak: 10 }), TODAY)).toBe(9);
  });

  it("is nothing behind the best, level with it, or on the days after", () => {
    expect(beatBestToday(streak({ ...played, currentStreak: 8, longestStreak: 9 }), TODAY)).toBeNull();
    expect(beatBestToday(streak({ ...played, currentStreak: 9, longestStreak: 9 }), TODAY)).toBeNull();
    expect(beatBestToday(streak({ ...played, currentStreak: 11, longestStreak: 11 }), TODAY)).toBeNull();
  });

  it("is nothing before today is played, or on a first ever streak", () => {
    expect(
      beatBestToday(streak({ ...played, currentStreak: 10, lastCompletedDate: "2026-10-30" }), TODAY)
    ).toBeNull();
    expect(beatBestToday(streak({ currentStreak: 1, lastCompletedDate: TODAY, bestToBeat: 0 }), TODAY)).toBeNull();
  });
});
