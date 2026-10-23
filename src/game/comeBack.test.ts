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
  it("tells a first-day player when the first freeze comes", () => {
    expect(streakGoal(streak({}))).toBe("2 days to your next 🧊 streak freeze.");
  });

  it("names the freeze tomorrow earns", () => {
    expect(streakGoal(streak({ currentStreak: 2, longestStreak: 2 }))).toMatch(
      /^Tomorrow earns a 🧊 freeze/
    );
    // Day 7 earns one too, while there is room under the cap.
    expect(
      streakGoal(streak({ currentStreak: 6, longestStreak: 6, bankedFreezes: 0 }))
    ).toMatch(/^Tomorrow earns/);
  });

  it("does not promise a freeze the cap would not keep", () => {
    // 4 days, one freeze held, cap 1 until 14 days: day 7 earns nothing kept,
    // and day 14 is the first that raises the cap.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 4, bankedFreezes: 1 }))
    ).toBe("10 days until you can hold 2 🧊 streak freezes.");
  });

  it("says the cap rises when it is full", () => {
    // Back on a 1-day run with a best past 3: one held, the cap rises at 14,
    // but beating the best of 5 is nearer.
    expect(
      streakGoal(streak({ currentStreak: 1, longestStreak: 5, bankedFreezes: 1 }))
    ).toBe("5 days to beat your best streak of 5.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 13, bankedFreezes: 1 }))
    ).toBe("Tomorrow you can hold 2 🧊 streak freezes, and you earn another 🧊.");
    expect(
      streakGoal(streak({ currentStreak: 20, longestStreak: 20, bankedFreezes: 2 }))
    ).toBe("8 days until you can hold 3 🧊 streak freezes.");
  });

  it("counts the freeze a holder would add when there is room for it", () => {
    // Cap 2 from a best of 20, one held: day 14 of this run earns the 2nd.
    expect(
      streakGoal(streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 1 }))
    ).toBe("6 days to a 2nd 🧊 streak freeze.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 20, bankedFreezes: 1 }))
    ).toBe("Tomorrow earns a 2nd 🧊 streak freeze.");
  });

  it("falls back to the best streak, then to a new record", () => {
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 }))
    ).toBe("11 days to beat your best streak of 40.");
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 3 }))
    ).toBe("This is your longest streak yet.");
  });

  it("names whichever of the next freeze and the best streak is nearer", () => {
    // Cap full at 1 until 14 days: the cap rises 10 days out, the best is 3 away.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 1 }))
    ).toBe("3 days to beat your best streak of 6.");
    // A tie goes to the freeze.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 0 }))
    ).toBe("3 days to your next 🧊 streak freeze.");
  });

  it("never says that tomorrow grows the streak", () => {
    for (let days = 1; days <= 60; days++) {
      for (const banked of [0, 1, 2, 3]) {
        const goal = streakGoal(streak({ currentStreak: days, longestStreak: days, bankedFreezes: banked }));
        expect(goal).not.toMatch(/make it a/);
      }
    }
  });
});
