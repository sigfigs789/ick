import { describe, expect, it } from "vitest";
import {
  applyFreezes,
  atRisk,
  coveredThrough,
  earnFreeze,
  freezeCap,
  savedFreezeCovering,
  streakReport,
} from "./streakFreeze";
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

describe("saved freezes", () => {
  it("caps at none under 14 days, one until 30, two from 30", () => {
    expect([1, 13, 14, 29, 30, 365].map(freezeCap)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("earns one on every seventh day, up to the cap", () => {
    expect(earnFreeze(streakOf({ currentStreak: 7 })).bankedFreezes).toBeUndefined();
    expect(earnFreeze(streakOf({ currentStreak: 13 })).bankedFreezes).toBeUndefined();
    expect(earnFreeze(streakOf({ currentStreak: 14 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ currentStreak: 21, bankedFreezes: 1 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ currentStreak: 35, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ currentStreak: 42, bankedFreezes: 2 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ currentStreak: 36, bankedFreezes: 0 })).bankedFreezes).toBe(0);
  });

  it("covers missed days past the grace day, one each", () => {
    const after = applyFreezes(streakOf({ bankedFreezes: 2 }), "2026-10-05");
    expect(after).toMatchObject({
      currentStreak: 10,
      bankedFreezes: 0,
      frozenDates: ["2026-10-02", "2026-10-03", "2026-10-04"],
    });
  });

  it("spends the same whether the gap is seen at once or a day at a time", () => {
    const start = streakOf({ bankedFreezes: 1 });
    const stepwise = applyFreezes(applyFreezes(start, "2026-10-03"), "2026-10-04");
    expect(stepwise).toEqual(applyFreezes(start, "2026-10-04"));
    expect(stepwise).toMatchObject({ currentStreak: 10, bankedFreezes: 0 });
  });

  it("covers the day after a frozen day with a saved freeze, never with the grace day", () => {
    const frozen = streakOf({ lastCompletedDate: "2026-10-01", frozenDates: ["2026-10-02"], bankedFreezes: 1 });
    expect(applyFreezes(frozen, "2026-10-04")).toMatchObject({ currentStreak: 10, bankedFreezes: 0 });
    expect(applyFreezes({ ...frozen, bankedFreezes: 0 }, "2026-10-04").currentStreak).toBe(0);
  });

  it("resets, losing the saved freezes, when they cannot cover the whole gap", () => {
    const after = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-05");
    expect(after).toMatchObject({ currentStreak: 0, bankedFreezes: 0 });
  });
});

describe("atRisk", () => {
  it("is true the day after a freeze until that day is played", () => {
    const frozen = applyFreezes(streakOf({}), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(true);
    expect(atRisk({ ...frozen, lastCompletedDate: "2026-10-03" }, "2026-10-03")).toBe(false);
  });

  it("is false the day after a freeze while a saved freeze is left", () => {
    const frozen = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(false);
  });

  it("is false on an ordinary day", () => {
    expect(atRisk(streakOf({}), "2026-10-02")).toBe(false);
    expect(atRisk(streakOf({ currentStreak: 0 }), "2026-10-02")).toBe(false);
  });
});

describe("savedFreezeCovering", () => {
  it("is false on the free missed day and true once a saved freeze covers one", () => {
    const start = streakOf({ bankedFreezes: 1 });
    expect(savedFreezeCovering(applyFreezes(start, "2026-10-03"), "2026-10-03")).toBe(false);
    expect(savedFreezeCovering(applyFreezes(start, "2026-10-04"), "2026-10-04")).toBe(true);
  });

  it("is false once today is played", () => {
    expect(savedFreezeCovering(streakOf({ lastCompletedDate: "2026-10-04" }), "2026-10-04")).toBe(false);
  });
});

describe("streakReport", () => {
  it("is null with no streak", () => {
    expect(streakReport(streakOf({ currentStreak: 0 }))).toBeNull();
  });

  it("reports the freezes saved on the last played day, before any were spent on the gap", () => {
    const start = streakOf({ longestStreak: 30, bankedFreezes: 2 });
    const expected = { current: 10, best: 30, saved: 2, lastPlayed: "2026-10-01" };
    expect(streakReport(start)).toEqual(expected);
    // The free day, then one saved freeze, spent since: still reported as 2.
    expect(streakReport(applyFreezes(start, "2026-10-03"))).toEqual(expected);
    expect(streakReport(applyFreezes(start, "2026-10-04"))).toEqual(expected);
  });
});
