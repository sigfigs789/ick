import { describe, expect, it } from "vitest";
import { streakGoal } from "./comeBack";
import type { StreakState } from "./types";

const streak = (over: Partial<StreakState>): StreakState => ({
  currentStreak: 1,
  longestStreak: 1,
  totalCompleted: 1,
  crushedIt: 0,
  elite: 0,
  highScore: 0,
  ...over,
});

describe("streakGoal", () => {
  it("tells a first-day player a streak starts tomorrow, and when the first freeze comes", () => {
    expect(streakGoal(streak({}))).toEqual({
      headline: "Play tomorrow to start a streak.",
      detail: "2 days to your next 🧊 streak freeze.",
    });
  });

  it("names the freeze tomorrow earns", () => {
    expect(streakGoal(streak({ currentStreak: 2, longestStreak: 2 })).detail).toMatch(
      /^Tomorrow earns a 🧊 freeze/
    );
    // Day 7 earns one too, while there is room under the cap.
    expect(
      streakGoal(streak({ currentStreak: 6, longestStreak: 6, bankedFreezes: 0 })).detail
    ).toMatch(/^Tomorrow earns/);
  });

  it("does not promise a freeze the cap would not keep", () => {
    // 4 days, one freeze held, cap 1 until 14 days: day 7 earns nothing kept,
    // and day 14 is the first that raises the cap.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 4, bankedFreezes: 1 }))
    ).toEqual({
      headline: "Play tomorrow to make it a 5-day streak.",
      detail: "10 days to a 2nd 🧊 streak freeze.",
    });
  });

  it("counts the freeze a holder would add, not a next one they already have", () => {
    // Back on a 1-day run with a best past 3: one held, the cap rises at 14.
    expect(
      streakGoal(streak({ currentStreak: 1, longestStreak: 5, bankedFreezes: 1 })).detail
    ).toBe("13 days to a 2nd 🧊 streak freeze.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 13, bankedFreezes: 1 })).detail
    ).toBe("Tomorrow earns a 2nd 🧊 streak freeze.");
    expect(
      streakGoal(streak({ currentStreak: 20, longestStreak: 20, bankedFreezes: 2 })).detail
    ).toBe("8 days to a 3rd 🧊 streak freeze.");
  });

  it("falls back to the best streak, then to a new record", () => {
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 })).detail
    ).toBe("11 days to beat your best streak of 40.");
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 3 })).detail
    ).toBe("This is your longest streak yet.");
  });
});
