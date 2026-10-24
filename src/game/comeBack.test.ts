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

// A Saturday, whose week can earn no more: the goals other than Saturday off.
const SATURDAY = "2026-11-07";

describe("streakGoal", () => {
  it("tells a first-day player when the first freeze comes", () => {
    expect(streakGoal(streak({}), SATURDAY)).toBe("2 days to your next 🧊 streak freeze.");
  });

  it("names the freeze tomorrow earns", () => {
    expect(streakGoal(streak({ currentStreak: 2, longestStreak: 2 }), SATURDAY)).toMatch(
      /^Tomorrow earns a 🧊 freeze/
    );
    // Day 7 earns one too, while there is room under the cap.
    expect(
      streakGoal(streak({ currentStreak: 6, longestStreak: 6, bankedFreezes: 0 }), SATURDAY)
    ).toMatch(/^Tomorrow earns/);
  });

  it("does not promise a freeze the cap would not keep", () => {
    // 4 days, one freeze held, cap 1 until 14 days: day 7 earns nothing kept,
    // and day 14 is the first that raises the cap.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 4, bankedFreezes: 1 }), SATURDAY)
    ).toBe("10 days until your 🧊 freeze limit goes up to 2.");
  });

  it("says the cap rises when it is full", () => {
    // Back on a 1-day run with a best past 3: one held, the cap rises at 14,
    // but beating the best of 5 is nearer.
    expect(
      streakGoal(streak({ currentStreak: 1, longestStreak: 5, bankedFreezes: 1 }), SATURDAY)
    ).toBe("5 days to beat your best streak of 5.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 13, bankedFreezes: 1 }), SATURDAY)
    ).toBe("Tomorrow your 🧊 freeze limit goes up to 2, and you earn a freeze to fill it.");
    // Two is the most the cap ever reaches, so a full one past 14 days never rises.
    expect(
      streakGoal(streak({ currentStreak: 20, longestStreak: 20, bankedFreezes: 2 }), SATURDAY)
    ).toBe("This is your longest streak yet.");
  });

  it("promises no freeze to a player still holding three from the old cap", () => {
    expect(
      streakGoal(streak({ currentStreak: 27, longestStreak: 40, bankedFreezes: 3 }), SATURDAY)
    ).toBe("14 days to beat your best streak of 40.");
  });

  it("counts the freeze a holder would add when there is room for it", () => {
    // Cap 2 from a best of 20, one held: day 14 of this run earns the 2nd.
    expect(
      streakGoal(streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 1 }), SATURDAY)
    ).toBe("6 days to a 2nd 🧊 streak freeze.");
    expect(
      streakGoal(streak({ currentStreak: 13, longestStreak: 20, bankedFreezes: 1 }), SATURDAY)
    ).toBe("Tomorrow earns a 2nd 🧊 streak freeze.");
  });

  it("falls back to the best streak, then to a new record", () => {
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 40, bankedFreezes: 3 }), SATURDAY)
    ).toBe("11 days to beat your best streak of 40.");
    expect(
      streakGoal(streak({ currentStreak: 30, longestStreak: 30, bankedFreezes: 3 }), SATURDAY)
    ).toBe("This is your longest streak yet.");
  });

  it("names whichever of the next freeze and the best streak is nearer", () => {
    // Cap full at 1 until 14 days: the cap rises 10 days out, the best is 3 away.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 1 }), SATURDAY)
    ).toBe("3 days to beat your best streak of 6.");
    // A tie goes to the freeze.
    expect(
      streakGoal(streak({ currentStreak: 4, longestStreak: 6, bankedFreezes: 0 }), SATURDAY)
    ).toBe("3 days to your next 🧊 streak freeze.");
  });

  it("never says that tomorrow grows the streak", () => {
    for (let days = 1; days <= 60; days++) {
      for (const banked of [0, 1, 2, 3]) {
        const goal = streakGoal(streak({ currentStreak: days, longestStreak: days, bankedFreezes: banked }), SATURDAY);
        expect(goal).not.toMatch(/make it a/);
      }
    }
  });

  describe("Saturday off", () => {
    // 2026-10-31 is the first Saturday that can be earned; its week is 10-25 to 10-30.
    const run = (playedDates: string[]) =>
      streak({ currentStreak: 8, longestStreak: 20, bankedFreezes: 2, playedDates });

    it("counts down the days still needed while the week has room", () => {
      expect(streakGoal(run(["2026-10-25"]), "2026-10-25")).toBe("2 more days by Friday earns Saturday off.");
      expect(streakGoal(run(["2026-10-27", "2026-10-28"]), "2026-10-28")).toBe(
        "Tomorrow earns Saturday off: skip it and your streak is safe."
      );
    });

    it("says on Friday that it is earned", () => {
      expect(streakGoal(run(["2026-10-26", "2026-10-28", "2026-10-30"]), "2026-10-30")).toBe(
        "You've earned Saturday off: skip tomorrow and your streak is safe."
      );
    });

    it("does not promise one the week has no room left for", () => {
      expect(streakGoal(run(["2026-10-30"]), "2026-10-30")).not.toMatch(/Saturday/);
    });

    it("comes after a freeze tomorrow earns", () => {
      expect(
        streakGoal(streak({ currentStreak: 2, longestStreak: 2, playedDates: ["2026-10-25"] }), "2026-10-25")
      ).toMatch(/^Tomorrow earns a 🧊 freeze/);
    });
  });
});
