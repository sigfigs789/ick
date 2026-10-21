import { describe, expect, it } from "vitest";
import {
  applyFreezes,
  atRisk,
  missedYesterday,
  backdateFreezes,
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

/** A player whose longest run is under a week: no freeze cap yet, so the grace day. */
function uncappedOf(overrides: Partial<StreakState>): StreakState {
  return streakOf({ currentStreak: 5, longestStreak: 5, ...overrides });
}

describe("applyFreezes", () => {
  it("leaves a streak that reaches yesterday alone", () => {
    const streak = streakOf({});
    expect(applyFreezes(streak, "2026-10-02")).toBe(streak);
  });

  it("covers one missed day without anything earned and keeps the count", () => {
    const after = applyFreezes(uncappedOf({}), "2026-10-03");
    expect(after).toMatchObject({ currentStreak: 5, frozenDates: ["2026-10-02"] });
    expect(coveredThrough(after)).toBe("2026-10-02");
  });

  it("is idempotent across reloads on the same day", () => {
    const once = applyFreezes(uncappedOf({}), "2026-10-03");
    expect(applyFreezes(once, "2026-10-03")).toBe(once);
  });

  it("resets a gap of two missed days", () => {
    const after = applyFreezes(uncappedOf({}), "2026-10-04");
    expect(after).toMatchObject({ currentStreak: 0, longestStreak: 5 });
  });

  it("does not freeze the day after a frozen day", () => {
    const frozen = applyFreezes(uncappedOf({}), "2026-10-03");
    expect(applyFreezes(frozen, "2026-10-04").currentStreak).toBe(0);
  });

  it("covers a later missed day again once a day has been played", () => {
    const streak = uncappedOf({ lastCompletedDate: "2026-10-03", frozenDates: ["2026-10-02"] });
    const after = applyFreezes(streak, "2026-10-05");
    expect(after).toMatchObject({ currentStreak: 5, frozenDates: ["2026-10-02", "2026-10-04"] });
  });

  it("forgets covered days after two months", () => {
    const after = applyFreezes(uncappedOf({ frozenDates: ["2026-07-01"] }), "2026-10-03");
    expect(after.frozenDates).toEqual(["2026-10-02"]);
  });
});

describe("saved freezes", () => {
  it("caps at none in the first week, one from 7 days, two from 14, three from 28", () => {
    expect([1, 6, 7, 13, 14, 27, 28, 365].map(freezeCap)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("earns one on every seventh day, up to the cap", () => {
    const fresh = { longestStreak: 0 };
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 6 })).bankedFreezes).toBeUndefined();
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 7 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 14, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 21, bankedFreezes: 2 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 28, bankedFreezes: 2 })).bankedFreezes).toBe(3);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 42, bankedFreezes: 3 })).bankedFreezes).toBe(3);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 36, bankedFreezes: 0 })).bankedFreezes).toBe(0);
  });

  it("keeps the cap a past streak reached, so a returning player earns from their first week", () => {
    const returning = { longestStreak: 40, bankedFreezes: 0 };
    expect(earnFreeze(streakOf({ ...returning, currentStreak: 7 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...returning, currentStreak: 14, bankedFreezes: 2 })).bankedFreezes).toBe(3);
    // A past 14-day streak caps at two.
    expect(earnFreeze(streakOf({ longestStreak: 20, currentStreak: 7, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    expect(
      earnFreeze(streakOf({ longestStreak: 20, currentStreak: 21, bankedFreezes: 2 })).bankedFreezes
    ).toBe(2);
  });

  it("gives no grace day once the player has a freeze cap: every missed day spends one", () => {
    const after = applyFreezes(streakOf({ bankedFreezes: 3 }), "2026-10-05");
    expect(after).toMatchObject({
      currentStreak: 10,
      bankedFreezes: 0,
      frozenDates: ["2026-10-02", "2026-10-03", "2026-10-04"],
    });
    expect(applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03")).toMatchObject({
      currentStreak: 10,
      bankedFreezes: 0,
      frozenDates: ["2026-10-02"],
    });
  });

  it("resets a capped streak with no saved freeze on its first missed day", () => {
    expect(applyFreezes(streakOf({}), "2026-10-03")).toMatchObject({ currentStreak: 0 });
    // The cap is set by the longest run, so a short new run is not let off.
    const returning = streakOf({ currentStreak: 2, longestStreak: 30, bankedFreezes: 0 });
    expect(applyFreezes(returning, "2026-10-03").currentStreak).toBe(0);
  });

  it("spends the same whether the gap is seen at once or a day at a time", () => {
    const start = streakOf({ bankedFreezes: 2 });
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
    const after = applyFreezes(streakOf({ bankedFreezes: 2 }), "2026-10-05");
    expect(after).toMatchObject({ currentStreak: 0, bankedFreezes: 0 });
  });
});

describe("atRisk", () => {
  it("is true the day after a freeze until that day is played", () => {
    const frozen = applyFreezes(uncappedOf({}), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(true);
    expect(atRisk({ ...frozen, lastCompletedDate: "2026-10-03" }, "2026-10-03")).toBe(false);
    // A capped player whose last saved freeze covered yesterday.
    const spent = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(atRisk(spent, "2026-10-03")).toBe(true);
  });

  it("is false the day after a freeze while a saved freeze is left", () => {
    const frozen = applyFreezes(streakOf({ bankedFreezes: 2 }), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(false);
    // Still a missed day, which the game says without calling it a risk.
    expect(missedYesterday(frozen, "2026-10-03")).toBe(true);
    expect(missedYesterday({ ...frozen, lastCompletedDate: "2026-10-03" }, "2026-10-03")).toBe(
      false
    );
  });

  it("is false on an ordinary day", () => {
    expect(atRisk(streakOf({}), "2026-10-02")).toBe(false);
    expect(atRisk(streakOf({ currentStreak: 0 }), "2026-10-02")).toBe(false);
  });
});

describe("savedFreezeCovering", () => {
  it("is false on the grace day and true once a saved freeze covers one", () => {
    const start = uncappedOf({});
    expect(savedFreezeCovering(applyFreezes(start, "2026-10-03"), "2026-10-03")).toBe(false);
  });

  it("is true from the first missed day once the player has a freeze cap", () => {
    const start = streakOf({ bankedFreezes: 2 });
    expect(savedFreezeCovering(applyFreezes(start, "2026-10-03"), "2026-10-03")).toBe(true);
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
    // One saved freeze, then another, spent since: still reported as 2.
    expect(streakReport(applyFreezes(start, "2026-10-03"))).toEqual(expected);
    expect(streakReport(applyFreezes(start, "2026-10-04"))).toEqual(expected);
  });

  it("does not count the grace day as a saved freeze spent", () => {
    const start = uncappedOf({});
    const expected = { current: 5, best: 5, saved: 0, lastPlayed: "2026-10-01" };
    expect(streakReport(applyFreezes(start, "2026-10-03"))).toEqual(expected);
  });
});

describe("backdateFreezes", () => {
  it("fills the streak to the cap its longest run set", () => {
    expect(backdateFreezes(streakOf({ currentStreak: 40, longestStreak: 40 }))).toMatchObject({
      bankedFreezes: 3,
      freezesBackdated: true,
    });
    expect(backdateFreezes(streakOf({ currentStreak: 20, longestStreak: 20 })).bankedFreezes).toBe(2);
    expect(backdateFreezes(streakOf({ currentStreak: 10, longestStreak: 10 })).bankedFreezes).toBe(1);
    expect(backdateFreezes(streakOf({ currentStreak: 5, longestStreak: 5 })).bankedFreezes).toBe(0);
  });

  it("does not depend on the length of the current run", () => {
    // A 48-day run before freezes existed, then a new run four days in.
    expect(backdateFreezes(streakOf({ currentStreak: 4, longestStreak: 48 })).bankedFreezes).toBe(3);
    expect(backdateFreezes(streakOf({ currentStreak: 1, longestStreak: 20 })).bankedFreezes).toBe(2);
  });

  it("never takes freezes away", () => {
    const streak = streakOf({ currentStreak: 15, longestStreak: 20, bankedFreezes: 3 });
    expect(backdateFreezes(streak).bankedFreezes).toBe(3);
  });

  it("runs only once", () => {
    const once = backdateFreezes(streakOf({ currentStreak: 4, longestStreak: 40 }));
    const spent = { ...once, bankedFreezes: 0 };
    expect(backdateFreezes(spent)).toBe(spent);
  });

  it("leaves a streak that has ended alone", () => {
    const ended = streakOf({ currentStreak: 0, longestStreak: 40 });
    expect(backdateFreezes(ended)).toBe(ended);
  });
});
