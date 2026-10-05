import { describe, expect, it } from "vitest";
import { comebackLine, formatCountdown, freezeLine, msUntilNextDrop } from "./nextDrop";
import type { StreakState } from "./types";

const TODAY = "2026-10-05";

function streakOf(currentStreak: number, longestStreak: number, freezes?: number): StreakState {
  return {
    currentStreak,
    longestStreak,
    lastCompletedDate: TODAY,
    totalCompleted: 0,
    crushedIt: 0,
    elite: 0,
    highScore: 0,
    freezes,
  };
}

describe("msUntilNextDrop / formatCountdown", () => {
  it("counts down to local midnight", () => {
    const ms = msUntilNextDrop(new Date(2026, 9, 5, 17, 48));
    expect(formatCountdown(ms)).toBe("6h 12m");
  });

  it("drops the hours and never reads zero early", () => {
    expect(formatCountdown(12 * 60_000)).toBe("12m");
    expect(formatCountdown(30_000)).toBe("under a minute");
    expect(formatCountdown(60 * 60_000 + 1)).toBe("1h 1m");
  });
});

describe("comebackLine", () => {
  it("says nothing before today is played", () => {
    expect(comebackLine({ ...streakOf(3, 3), lastCompletedDate: "2026-10-04" }, TODAY)).toBeNull();
  });

  it("calls out a new best", () => {
    expect(comebackLine(streakOf(5, 5), TODAY)).toBe("Play tomorrow for a new best: a 6-day streak.");
  });

  it("counts down to beating a close best", () => {
    expect(comebackLine(streakOf(8, 9), TODAY)).toBe("2 more days to beat your best streak of 9.");
    expect(comebackLine(streakOf(9, 9), TODAY)).toBe("Play tomorrow for a new best: a 10-day streak.");
  });

  it("points at a nearby freeze when the best is far", () => {
    expect(comebackLine(streakOf(5, 30), TODAY)).toBe(
      "Play tomorrow for a 6-day streak. 2 days to your next streak freeze."
    );
    // No freeze talk with a full hand.
    expect(comebackLine(streakOf(5, 30, 2), TODAY)).toBe("Play tomorrow for a 6-day streak.");
  });

  it("says an 8-day and an 11-day streak", () => {
    expect(comebackLine(streakOf(7, 7), TODAY)).toBe("Play tomorrow for a new best: an 8-day streak.");
    expect(comebackLine(streakOf(10, 40, 2), TODAY)).toBe("Play tomorrow for an 11-day streak.");
  });

  it("falls back to tomorrow's number", () => {
    expect(comebackLine(streakOf(1, 30), TODAY)).toBe("Play tomorrow for a 2-day streak.");
  });
});

describe("freezeLine", () => {
  it("is silent with no freezes", () => {
    expect(freezeLine(streakOf(3, 3), TODAY)).toBeNull();
  });

  it("names the freezes held, and announces one earned today", () => {
    expect(freezeLine(streakOf(9, 9, 2), TODAY)).toBe(
      "You have 2 streak freezes: miss a day and your streak survives."
    );
    expect(freezeLine({ ...streakOf(7, 7, 1), freezeEarnedOn: TODAY }, TODAY)).toBe(
      "You earned a streak freeze for a 7-day streak. You have 1 streak freeze: miss a day and your streak survives."
    );
  });
});
