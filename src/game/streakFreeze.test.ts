import { describe, expect, it } from "vitest";
import { applyFreezes, atRisk, coveredThrough } from "./streakFreeze";
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
    const streak = streakOf({});
    expect(applyFreezes(streak, "2026-10-02")).toBe(streak);
  });

  it("covers one missed day without anything earned and keeps the count", () => {
    const after = applyFreezes(streakOf({}), "2026-10-03");
    expect(after).toMatchObject({ currentStreak: 10, frozenDates: ["2026-10-02"] });
    expect(coveredThrough(after)).toBe("2026-10-02");
  });

  it("is idempotent across reloads on the same day", () => {
    const once = applyFreezes(streakOf({}), "2026-10-03");
    expect(applyFreezes(once, "2026-10-03")).toBe(once);
  });

  it("resets a gap of two missed days", () => {
    const after = applyFreezes(streakOf({}), "2026-10-04");
    expect(after).toMatchObject({ currentStreak: 0, longestStreak: 10 });
  });

  it("does not freeze the day after a frozen day", () => {
    const frozen = applyFreezes(streakOf({}), "2026-10-03");
    expect(applyFreezes(frozen, "2026-10-04").currentStreak).toBe(0);
  });

  it("covers a later missed day again once a day has been played", () => {
    const streak = streakOf({ lastCompletedDate: "2026-10-03", frozenDates: ["2026-10-02"] });
    const after = applyFreezes(streak, "2026-10-05");
    expect(after).toMatchObject({ currentStreak: 10, frozenDates: ["2026-10-02", "2026-10-04"] });
  });

  it("forgets covered days after two months", () => {
    const after = applyFreezes(streakOf({ frozenDates: ["2026-07-01"] }), "2026-10-03");
    expect(after.frozenDates).toEqual(["2026-10-02"]);
  });
});

describe("atRisk", () => {
  it("is true the day after a freeze until that day is played", () => {
    const frozen = applyFreezes(streakOf({}), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(true);
    expect(atRisk({ ...frozen, lastCompletedDate: "2026-10-03" }, "2026-10-03")).toBe(false);
  });

  it("is false on an ordinary day", () => {
    expect(atRisk(streakOf({}), "2026-10-02")).toBe(false);
    expect(atRisk(streakOf({ currentStreak: 0 }), "2026-10-02")).toBe(false);
  });
});
