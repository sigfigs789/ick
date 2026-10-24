import { describe, expect, it } from "vitest";
import {
  applyFreezes,
  atRisk,
  missedYesterday,
  backdateFreezes,
  coveredThrough,
  earnFreeze,
  freezeCap,
  freezesOn,
  isRestDay,
  missedDays,
  recordFreezes,
  recordPlayed,
  restDayProgress,
  resting,
  savedFreezeCovering,
  startStreak,
  streakReport,
  weekdayRestProgress,
  weekPlays,
  welcomeBack,
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

  it("covers a missed day with a saved freeze and keeps the count", () => {
    const after = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(after).toMatchObject({ currentStreak: 10, bankedFreezes: 0, frozenDates: ["2026-10-02"] });
    expect(coveredThrough(after)).toBe("2026-10-02");
  });

  it("gives no free missed day: with no saved freeze the first missed day resets", () => {
    expect(applyFreezes(streakOf({}), "2026-10-03")).toMatchObject({ currentStreak: 0, longestStreak: 10 });
    // Not even a run too short to hold a freeze yet.
    const short = streakOf({ currentStreak: 2, longestStreak: 2 });
    expect(applyFreezes(short, "2026-10-03").currentStreak).toBe(0);
    // Nor a returning player whose new run has not earned one.
    const returning = streakOf({ currentStreak: 2, longestStreak: 30, bankedFreezes: 0 });
    expect(applyFreezes(returning, "2026-10-03").currentStreak).toBe(0);
  });

  it("is idempotent across reloads on the same day", () => {
    const once = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(applyFreezes(once, "2026-10-03")).toBe(once);
  });

  it("resets a gap of two missed days with one saved freeze", () => {
    const after = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-04");
    expect(after).toMatchObject({ currentStreak: 0, longestStreak: 10 });
  });

  it("does not freeze the day after a frozen day once the freezes are spent", () => {
    const frozen = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(applyFreezes(frozen, "2026-10-04").currentStreak).toBe(0);
  });

  it("covers a later missed day again with another saved freeze", () => {
    const streak = streakOf({
      lastCompletedDate: "2026-10-03",
      frozenDates: ["2026-10-02"],
      bankedFreezes: 1,
    });
    const after = applyFreezes(streak, "2026-10-05");
    expect(after).toMatchObject({ currentStreak: 10, frozenDates: ["2026-10-02", "2026-10-04"] });
  });

  it("records the freezes each covered day ended with", () => {
    const after = applyFreezes(streakOf({ longestStreak: 30, bankedFreezes: 3 }), "2026-10-04");
    // Three held from the old cap of three, over today's cap of two.
    expect(freezesOn(after, "2026-10-02")).toEqual({ banked: 2, cap: 2 });
    expect(freezesOn(after, "2026-10-03")).toEqual({ banked: 1, cap: 2 });
    // Today, not covered yet, is what is held now.
    expect(freezesOn(after, "2026-10-04")).toEqual({ banked: 1, cap: 2 });
  });

  it("records none held on the days of a gap that ended the streak", () => {
    const after = applyFreezes(streakOf({ longestStreak: 30, bankedFreezes: 1 }), "2026-10-04");
    expect(freezesOn(after, "2026-10-02")).toEqual({ banked: 0, cap: 2 });
  });

  it("forgets covered days after two months", () => {
    const after = applyFreezes(streakOf({ frozenDates: ["2026-07-01"], bankedFreezes: 1 }), "2026-10-03");
    expect(after.frozenDates).toEqual(["2026-10-02"]);
  });
});

// 2026-10-31 is the first Saturday that can be a rest day; its week is 10-25 to 10-30.
const WEEK_PLAYED = ["2026-10-26", "2026-10-28", "2026-10-29"];

describe("Saturday rest days", () => {
  it("are the Saturdays from 2026-10-31 on that three days played that week earned", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(isRestDay(earned, "2026-10-31")).toBe(true);
    expect(weekPlays(earned, "2026-10-31")).toBe(3);
    // Not earned on two days played.
    expect(isRestDay(streakOf({ playedDates: WEEK_PLAYED.slice(1) }), "2026-10-31")).toBe(false);
    // An earlier Saturday was an ordinary day, earned or not.
    expect(isRestDay(streakOf({ playedDates: ["2026-10-19", "2026-10-20", "2026-10-21"] }), "2026-10-24")).toBe(
      false
    );
    expect(isRestDay(earned, "2026-10-30")).toBe(false);
  });

  it("expire with their Saturday: a week's play earns that one and no other", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(isRestDay(earned, "2026-11-07")).toBe(false);
    // Saturday itself played does not count towards the next week.
    const withSaturday = streakOf({ playedDates: [...WEEK_PLAYED, "2026-10-31", "2026-11-01"] });
    expect(weekPlays(withSaturday, "2026-11-07")).toBe(1);
  });

  it("are not missed days, but an unearned Saturday is", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(missedDays(earned, "2026-10-30", "2026-11-01")).toEqual([]);
    expect(missedDays(earned, "2026-10-29", "2026-11-02")).toEqual(["2026-10-30", "2026-11-01"]);
    expect(missedDays(streakOf({}), "2026-10-30", "2026-11-01")).toEqual(["2026-10-31"]);
  });

  it("keep a streak with no saved freeze, spending none and adding nothing", () => {
    const friday = streakOf({ lastCompletedDate: "2026-10-30", playedDates: WEEK_PLAYED });
    expect(applyFreezes(friday, "2026-11-01")).toBe(friday);
    expect(savedFreezeCovering(friday, "2026-11-01")).toBe(false);
    // Sunday missed too: that one is a missed day like any other.
    expect(applyFreezes(friday, "2026-11-02").currentStreak).toBe(0);
  });

  it("spend a freeze or end the streak when not earned", () => {
    const friday = streakOf({ lastCompletedDate: "2026-10-30", playedDates: ["2026-10-30"] });
    expect(applyFreezes(friday, "2026-11-01").currentStreak).toBe(0);
    const covered = applyFreezes({ ...friday, bankedFreezes: 1 }, "2026-11-01");
    expect(covered).toMatchObject({ currentStreak: 10, bankedFreezes: 0, frozenDates: ["2026-10-31"] });
  });

  it("are skipped over when a freeze covers the day before", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", bankedFreezes: 1, playedDates: WEEK_PLAYED });
    const sunday = applyFreezes(thursday, "2026-11-01");
    expect(sunday).toMatchObject({ currentStreak: 10, bankedFreezes: 0, frozenDates: ["2026-10-30"] });
    // Friday's freeze was the last, so Sunday is the day the streak is at risk.
    expect(atRisk(sunday, "2026-11-01")).toBe(true);
  });

  it("are never at risk when earned, and rest the streak until played", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", bankedFreezes: 1, playedDates: WEEK_PLAYED });
    const saturday = applyFreezes(thursday, "2026-10-31");
    expect(missedYesterday(saturday, "2026-10-31")).toBe(true);
    expect(atRisk(saturday, "2026-10-31")).toBe(false);
    expect(resting(saturday, "2026-10-31")).toBe(true);
    expect(resting({ ...saturday, lastCompletedDate: "2026-10-31" }, "2026-10-31")).toBe(false);
    expect(resting(streakOf({ currentStreak: 0, playedDates: WEEK_PLAYED }), "2026-10-31")).toBe(false);
    expect(resting(streakOf({ lastCompletedDate: "2026-10-31", playedDates: WEEK_PLAYED }), "2026-11-01")).toBe(
      false
    );
  });

  it("can be at risk when not earned", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", bankedFreezes: 1, playedDates: ["2026-10-29"] });
    const saturday = applyFreezes(thursday, "2026-10-31");
    expect(resting(saturday, "2026-10-31")).toBe(false);
    expect(atRisk(saturday, "2026-10-31")).toBe(true);
  });
});

describe("recordPlayed", () => {
  it("remembers the last two weeks of days played", () => {
    const played = recordPlayed(streakOf({ playedDates: ["2026-10-01", "2026-10-20"] }), "2026-10-26");
    expect(played.playedDates).toEqual(["2026-10-20", "2026-10-26"]);
    expect(recordPlayed(played, "2026-10-26").playedDates).toEqual(["2026-10-20", "2026-10-26"]);
  });
});

describe("weekdayRestProgress", () => {
  it("counts the week's days played, and whether three can still be reached", () => {
    // Wednesday, two played, today not yet.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-26", "2026-10-27"] }), "2026-10-28")).toEqual({
      played: 2,
      reachable: true,
    });
    expect(weekdayRestProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-30")).toEqual({
      played: 3,
      reachable: true,
    });
    // Friday, one played and today not yet: still shown, out of reach.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-26"] }), "2026-10-30")).toEqual({
      played: 1,
      reachable: false,
    });
    // Thursday, one played and today not yet: today and Friday make three.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-26"] }), "2026-10-29")?.reachable).toBe(true);
    // Saturday shows 😴 itself, and weeks before rest days began show nothing.
    expect(weekdayRestProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-31")).toBeNull();
    expect(weekdayRestProgress(streakOf({ playedDates: [] }), "2026-10-20")).toBeNull();
  });
});

describe("restDayProgress", () => {
  it("counts down the plays Saturday off still needs while the week has room", () => {
    // Sunday played: two more of the five days left.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-25"] }), "2026-10-25")).toEqual({
      saturday: "2026-10-31",
      needed: 2,
    });
    // Thursday with one played: two needed, one day left.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-29"] }), "2026-10-29")).toBeNull();
    // Earned.
    expect(restDayProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-30")).toEqual({
      saturday: "2026-10-31",
      needed: 0,
    });
    // On Saturday the week is over.
    expect(restDayProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-31")).toBeNull();
    // Before rest days began.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-19"] }), "2026-10-19")).toBeNull();
  });
});

describe("saved freezes", () => {
  it("caps at none in the first two days, one from 3 days, two from 14", () => {
    expect([1, 2, 3, 13, 14, 27, 28, 365].map(freezeCap)).toEqual([0, 0, 1, 1, 2, 2, 2, 2]);
  });

  it("earns the first on the third day, then one on every seventh day, up to the cap", () => {
    const fresh = { longestStreak: 0 };
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 2 })).bankedFreezes).toBeUndefined();
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 3 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 4, bankedFreezes: 0 })).bankedFreezes).toBe(0);
    // Spent since day 3: day 7 earns it back.
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 7, bankedFreezes: 0 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 7, bankedFreezes: 1 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 6 })).bankedFreezes).toBeUndefined();
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 7 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 14, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 21, bankedFreezes: 2 })).bankedFreezes).toBe(2);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 28, bankedFreezes: 2 })).bankedFreezes).toBe(2);
    // Three held from the old cap are kept, though no more are earned.
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 42, bankedFreezes: 3 })).bankedFreezes).toBe(3);
    expect(earnFreeze(streakOf({ ...fresh, currentStreak: 36, bankedFreezes: 0 })).bankedFreezes).toBe(0);
  });

  it("keeps the cap a past streak reached, so a returning player earns from their first week", () => {
    const returning = { longestStreak: 40, bankedFreezes: 0 };
    expect(earnFreeze(streakOf({ ...returning, currentStreak: 3 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...returning, currentStreak: 7 })).bankedFreezes).toBe(1);
    expect(earnFreeze(streakOf({ ...returning, currentStreak: 14, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    // A past 14-day streak caps at two.
    expect(earnFreeze(streakOf({ longestStreak: 20, currentStreak: 7, bankedFreezes: 1 })).bankedFreezes).toBe(2);
    expect(
      earnFreeze(streakOf({ longestStreak: 20, currentStreak: 21, bankedFreezes: 2 })).bankedFreezes
    ).toBe(2);
  });

  it("spends one on every missed day", () => {
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

  it("spends the same whether the gap is seen at once or a day at a time", () => {
    const start = streakOf({ bankedFreezes: 2 });
    const stepwise = applyFreezes(applyFreezes(start, "2026-10-03"), "2026-10-04");
    expect(stepwise).toEqual(applyFreezes(start, "2026-10-04"));
    expect(stepwise).toMatchObject({ currentStreak: 10, bankedFreezes: 0 });
  });

  it("covers the day after a frozen day with another saved freeze", () => {
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
    const frozen = applyFreezes(streakOf({ bankedFreezes: 1 }), "2026-10-03");
    expect(atRisk(frozen, "2026-10-03")).toBe(true);
    expect(atRisk({ ...frozen, lastCompletedDate: "2026-10-03" }, "2026-10-03")).toBe(false);
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
  it("is false with nothing missed", () => {
    expect(savedFreezeCovering(streakOf({}), "2026-10-02")).toBe(false);
  });

  it("is true from the first missed day", () => {
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

  it("names the Saturday the last played day's week earned", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", playedDates: WEEK_PLAYED });
    expect(streakReport(thursday)?.restDay).toBe("2026-10-31");
    expect(streakReport({ ...thursday, playedDates: ["2026-10-29"] })?.restDay).toBeUndefined();
    // A Saturday played: next week's Saturday is not earned yet.
    expect(streakReport({ ...thursday, lastCompletedDate: "2026-10-31" })?.restDay).toBeUndefined();
  });
});

describe("backdateFreezes", () => {
  it("fills the streak to the cap its longest run set", () => {
    expect(backdateFreezes(streakOf({ currentStreak: 40, longestStreak: 40 }))).toMatchObject({
      bankedFreezes: 2,
      freezesBackdated: true,
    });
    expect(backdateFreezes(streakOf({ currentStreak: 20, longestStreak: 20 })).bankedFreezes).toBe(2);
    expect(backdateFreezes(streakOf({ currentStreak: 10, longestStreak: 10 })).bankedFreezes).toBe(1);
    expect(backdateFreezes(streakOf({ currentStreak: 5, longestStreak: 5 })).bankedFreezes).toBe(1);
    expect(backdateFreezes(streakOf({ currentStreak: 2, longestStreak: 2 })).bankedFreezes).toBe(0);
  });

  it("does not depend on the length of the current run", () => {
    // A 48-day run before freezes existed, then a new run four days in.
    expect(backdateFreezes(streakOf({ currentStreak: 4, longestStreak: 48 })).bankedFreezes).toBe(2);
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

describe("recordFreezes", () => {
  it("keeps a played day's freezes for its puzzle after they change", () => {
    const played = recordFreezes(streakOf({ currentStreak: 14, longestStreak: 14, bankedFreezes: 1 }), "2026-10-01");
    expect(freezesOn(played, "2026-10-01")).toEqual({ banked: 1, cap: 2 });
    const spent = applyFreezes(played, "2026-10-03");
    expect(freezesOn(spent, "2026-10-01")).toEqual({ banked: 1, cap: 2 });
    expect(freezesOn(spent, "2026-10-02")).toEqual({ banked: 0, cap: 2 });
  });

  it("forgets days after two months", () => {
    const old = recordFreezes(streakOf({ bankedFreezes: 1 }), "2026-07-01");
    expect(recordFreezes(old, "2026-10-01").freezeHistory).not.toHaveProperty("2026-07-01");
  });
});

describe("welcomeBack", () => {
  const lapsed = { currentStreak: 0, longestStreak: 12, lastCompletedDate: "2026-10-01" };

  it("greets a player whose ended streak once reached 3 days", () => {
    expect(welcomeBack(streakOf(lapsed), "2026-10-10")).toEqual({
      best: 12,
      lastPlayed: "2026-10-01",
      freeze: true,
    });
  });

  it("greets nobody who never reached 3 days, never played, or has a live streak", () => {
    expect(welcomeBack(streakOf({ ...lapsed, longestStreak: 2 }), "2026-10-10")).toBeNull();
    expect(welcomeBack(streakOf({ ...lapsed, lastCompletedDate: undefined }), "2026-10-10")).toBeNull();
    expect(welcomeBack(streakOf({ currentStreak: 4, lastCompletedDate: "2026-10-09" }), "2026-10-10")).toBeNull();
  });

  it("offers the freeze at most once every 30 days", () => {
    const given = streakOf({ ...lapsed, welcomeBackFreezeDate: "2026-09-15" });
    expect(welcomeBack(given, "2026-10-10")?.freeze).toBe(false);
    expect(welcomeBack(given, "2026-10-15")?.freeze).toBe(true);
  });
});

describe("startStreak", () => {
  it("starts a returning player's streak with one saved freeze, and records the day", () => {
    const lapsed = streakOf({ currentStreak: 0, longestStreak: 5, lastCompletedDate: "2026-10-01" });
    expect(startStreak(lapsed, "2026-10-10")).toEqual({
      bankedFreezes: 1,
      welcomeBackFreezeDate: "2026-10-10",
    });
  });

  it("starts anyone else's with none", () => {
    const fresh = streakOf({ currentStreak: 0, longestStreak: 0, lastCompletedDate: undefined });
    expect(startStreak(fresh, "2026-10-10")).toMatchObject({ bankedFreezes: 0 });
    const recent = streakOf({
      currentStreak: 0,
      longestStreak: 5,
      lastCompletedDate: "2026-10-01",
      welcomeBackFreezeDate: "2026-10-01",
    });
    expect(startStreak(recent, "2026-10-10")).toEqual({
      bankedFreezes: 0,
      welcomeBackFreezeDate: "2026-10-01",
    });
  });
});
