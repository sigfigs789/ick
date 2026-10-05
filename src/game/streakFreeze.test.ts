import { describe, expect, it } from "vitest";
import { applyFreezes, coveredThrough, earnFreeze, MAX_FREEZES } from "./streakFreeze";
import type { StreakState } from "./types";

function streakOf(overrides: Partial<StreakState>): StreakState {
  return {
    currentStreak: 10,
    longestStreak: 10,
    lastCompletedDate: "2026-10-01",
    totalCompleted: 0,
    crushedIt: 0,
    elite: 0,
    highScore: 0,
    ...overrides,
  };
}

describe("applyFreezes", () => {
  it("leaves a streak that reaches yesterday alone", () => {
    const streak = streakOf({ freezes: 1 });
    expect(applyFreezes(streak, "2026-10-02")).toBe(streak);
  });

  it("spends a freeze on one missed day and keeps the count", () => {
    const after = applyFreezes(streakOf({ freezes: 1 }), "2026-10-03");
    expect(after).toMatchObject({ currentStreak: 10, freezes: 0, frozenDates: ["2026-10-02"] });
    expect(coveredThrough(after)).toBe("2026-10-02");
  });

  it("covers two missed days with two freezes", () => {
    const after = applyFreezes(streakOf({ freezes: 2 }), "2026-10-04");
    expect(after).toMatchObject({
      currentStreak: 10,
      freezes: 0,
      frozenDates: ["2026-10-02", "2026-10-03"],
    });
  });

  it("resets a gap too long to bridge and keeps the freezes", () => {
    const after = applyFreezes(streakOf({ freezes: 1 }), "2026-10-04");
    expect(after).toMatchObject({ currentStreak: 0, freezes: 1, longestStreak: 10 });
  });

  it("resets without freezes, as before", () => {
    expect(applyFreezes(streakOf({}), "2026-10-03").currentStreak).toBe(0);
  });

  it("forgets covered days after two months", () => {
    const after = applyFreezes(
      streakOf({ freezes: 1, frozenDates: ["2026-07-01"] }),
      "2026-10-03"
    );
    expect(after.frozenDates).toEqual(["2026-10-02"]);
  });
});

describe("earnFreeze", () => {
  it("earns one every seventh day", () => {
    expect(earnFreeze(streakOf({ currentStreak: 7 })).freezes).toBe(1);
    expect(earnFreeze(streakOf({ currentStreak: 14, freezes: 1 })).freezes).toBe(2);
    expect(earnFreeze(streakOf({ currentStreak: 8 })).freezes).toBeUndefined();
  });

  it("holds no more than the cap", () => {
    const full = streakOf({ currentStreak: 21, freezes: MAX_FREEZES });
    expect(earnFreeze(full)).toBe(full);
  });
});
