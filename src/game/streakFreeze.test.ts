import { describe, expect, it } from "vitest";
import {
  freezeProgress,
  applyFreezes,
  atRisk,
  missedYesterday,
  backdateFreezes,
  coveredThrough,
  daysToFreeze,
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
  weekSaturday,
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

// 2026-10-31 is the first Saturday that can be a rest day; its week runs 10-26 to 11-01.
const WEEK_PLAYED = ["2026-10-26", "2026-10-28", "2026-10-29"];

describe("Weekend rest days", () => {
  it("are the weekends from 2026-10-31 on that three days played that week earned", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(isRestDay(earned, "2026-10-31")).toBe(true);
    // The Sunday after, though it opens the next week.
    expect(isRestDay(earned, "2026-11-01")).toBe(true);
    expect(weekPlays(earned, "2026-10-31")).toBe(3);
    // Not earned on two days played.
    expect(isRestDay(streakOf({ playedDates: WEEK_PLAYED.slice(1) }), "2026-10-31")).toBe(false);
    // An earlier Saturday was an ordinary day, earned or not.
    expect(isRestDay(streakOf({ playedDates: ["2026-10-19", "2026-10-20", "2026-10-21"] }), "2026-10-24")).toBe(
      false
    );
    expect(isRestDay(streakOf({ playedDates: ["2026-10-19", "2026-10-20", "2026-10-21"] }), "2026-10-25")).toBe(
      false
    );
    expect(isRestDay(earned, "2026-10-30")).toBe(false);
    expect(isRestDay(earned, "2026-10-25")).toBe(false);
  });

  it("expire with their weekend: a week's play earns that one and no other", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(isRestDay(earned, "2026-11-02")).toBe(false);
    expect(isRestDay(earned, "2026-11-07")).toBe(false);
    expect(isRestDay(earned, "2026-11-08")).toBe(false);
    // A weekend played counts towards its own week's: a Sunday towards none.
    const withWeekend = streakOf({ playedDates: [...WEEK_PLAYED, "2026-10-31", "2026-11-01"] });
    expect(weekPlays(withWeekend, "2026-10-31")).toBe(4);
    expect(weekPlays(withWeekend, "2026-11-07")).toBe(0);
  });

  it("start the week on Monday, so the Sunday before counts for nothing", () => {
    const fromSunday = streakOf({ playedDates: ["2026-11-01", "2026-11-02", "2026-11-03"] });
    expect(weekPlays(fromSunday, "2026-11-07")).toBe(2);
    expect(isRestDay(fromSunday, "2026-11-07")).toBe(false);
    expect(isRestDay(fromSunday, "2026-11-08")).toBe(false);
  });

  it("count Sunday 2026-10-25 towards the first weekend, its week having taken it in", () => {
    const fromSunday = streakOf({ playedDates: ["2026-10-25", "2026-10-26", "2026-10-27"] });
    expect(weekSaturday("2026-10-25")).toBe("2026-10-31");
    expect(weekPlays(fromSunday, "2026-10-31")).toBe(3);
    expect(isRestDay(fromSunday, "2026-10-25")).toBe(false);
    expect(isRestDay(fromSunday, "2026-10-31")).toBe(true);
    expect(isRestDay(fromSunday, "2026-11-01")).toBe(true);
    // Played, it is the first of the three, with the whole week still to come.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-25"] }), "2026-10-25")).toEqual({
      played: 1,
      reachable: true,
      sundayOnly: false,
    });
    // Not played yet, it is one of the days left to play.
    expect(weekdayRestProgress(streakOf({}), "2026-10-25")?.played).toBe(0);
  });

  it("count a Saturday played towards its own Sunday", () => {
    // Two weekdays, then Saturday as the third: Sunday rests, Saturday was played.
    const earned = streakOf({ playedDates: ["2026-10-27", "2026-10-29", "2026-10-31"] });
    expect(weekPlays(earned, "2026-10-31")).toBe(3);
    expect(isRestDay(earned, "2026-10-31")).toBe(false);
    expect(isRestDay(earned, "2026-11-01")).toBe(true);
    expect(missedDays(earned, "2026-10-31", "2026-11-02")).toEqual([]);
    // Saturday unplayed, two weekdays leave both days ordinary.
    expect(isRestDay(streakOf({ playedDates: ["2026-10-27", "2026-10-29"] }), "2026-11-01")).toBe(false);
  });

  it("are not missed days, but an unearned weekend is", () => {
    const earned = streakOf({ playedDates: WEEK_PLAYED });
    expect(missedDays(earned, "2026-10-30", "2026-11-02")).toEqual([]);
    expect(missedDays(earned, "2026-10-29", "2026-11-03")).toEqual(["2026-10-30", "2026-11-02"]);
    expect(missedDays(streakOf({}), "2026-10-30", "2026-11-02")).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("keep a streak with no saved freeze, spending none and adding nothing", () => {
    const friday = streakOf({ lastCompletedDate: "2026-10-30", playedDates: WEEK_PLAYED });
    expect(applyFreezes(friday, "2026-11-01")).toBe(friday);
    expect(applyFreezes(friday, "2026-11-02")).toBe(friday);
    expect(savedFreezeCovering(friday, "2026-11-02")).toBe(false);
    // Monday missed too: that one is a missed day like any other.
    expect(applyFreezes(friday, "2026-11-03").currentStreak).toBe(0);
  });

  it("spend a freeze or end the streak when not earned", () => {
    const friday = streakOf({ lastCompletedDate: "2026-10-30", playedDates: ["2026-10-30"] });
    expect(applyFreezes(friday, "2026-11-01").currentStreak).toBe(0);
    const covered = applyFreezes({ ...friday, bankedFreezes: 1 }, "2026-11-01");
    expect(covered).toMatchObject({ currentStreak: 10, bankedFreezes: 0, frozenDates: ["2026-10-31"] });
  });

  it("are skipped over when a freeze covers the day before", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", bankedFreezes: 1, playedDates: WEEK_PLAYED });
    const monday = applyFreezes(thursday, "2026-11-02");
    expect(monday).toMatchObject({ currentStreak: 10, bankedFreezes: 0, frozenDates: ["2026-10-30"] });
    // Friday's freeze was the last, so Monday is the day the streak is at risk.
    expect(missedYesterday(monday, "2026-11-02")).toBe(true);
    expect(atRisk(monday, "2026-11-02")).toBe(true);
    // Not Sunday, which rests.
    expect(atRisk(applyFreezes(thursday, "2026-11-01"), "2026-11-01")).toBe(false);
  });

  it("are never at risk when earned, and rest the streak until played", () => {
    const thursday = streakOf({ lastCompletedDate: "2026-10-29", bankedFreezes: 1, playedDates: WEEK_PLAYED });
    const saturday = applyFreezes(thursday, "2026-10-31");
    expect(missedYesterday(saturday, "2026-10-31")).toBe(true);
    expect(atRisk(saturday, "2026-10-31")).toBe(false);
    expect(resting(saturday, "2026-10-31")).toBe(true);
    expect(resting({ ...saturday, lastCompletedDate: "2026-10-31" }, "2026-10-31")).toBe(false);
    expect(resting(streakOf({ currentStreak: 0, playedDates: WEEK_PLAYED }), "2026-10-31")).toBe(false);
    // Sunday rests too, even after Saturday was played.
    expect(resting(saturday, "2026-11-01")).toBe(true);
    expect(resting(streakOf({ lastCompletedDate: "2026-10-31", playedDates: WEEK_PLAYED }), "2026-11-01")).toBe(
      true
    );
    expect(resting(streakOf({ lastCompletedDate: "2026-11-01", playedDates: WEEK_PLAYED }), "2026-11-01")).toBe(
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
      sundayOnly: false,
    });
    expect(weekdayRestProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-30")).toEqual({
      played: 3,
      reachable: true,
      sundayOnly: false,
    });
    // Friday, one played and today not yet: today and Saturday make three, for Sunday.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-26"] }), "2026-10-30")).toEqual({
      played: 1,
      reachable: true,
      sundayOnly: true,
    });
    // Friday, none played: still shown, out of reach.
    expect(weekdayRestProgress(streakOf({ playedDates: [] }), "2026-10-30")).toMatchObject({
      played: 0,
      reachable: false,
    });
    // Thursday, one played and today not yet: today and Friday make three.
    expect(weekdayRestProgress(streakOf({ playedDates: ["2026-10-26"] }), "2026-10-29")).toMatchObject({
      reachable: true,
      sundayOnly: false,
    });
    // An earned Saturday shows 😴 itself, and weeks before rest days began show nothing.
    expect(weekdayRestProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-31")).toBeNull();
    expect(weekdayRestProgress(streakOf({ playedDates: [] }), "2026-10-20")).toBeNull();
    expect(weekdayRestProgress(streakOf({ playedDates: [] }), "2026-10-24")).toBeNull();
    // An unearned Saturday with two played: today makes three, for Sunday.
    const two = ["2026-10-27", "2026-10-29"];
    expect(weekdayRestProgress(streakOf({ playedDates: two }), "2026-10-31")).toEqual({
      played: 2,
      reachable: true,
      sundayOnly: true,
    });
    // And once played as the third, Sunday is unlocked.
    expect(
      weekdayRestProgress(
        streakOf({ lastCompletedDate: "2026-10-31", playedDates: [...two, "2026-10-31"] }),
        "2026-10-31"
      )
    ).toEqual({ played: 3, reachable: true, sundayOnly: true });
    // An earned Sunday shows 😴 all day, played or not: next week's count waits for Monday.
    const sunday = streakOf({ lastCompletedDate: "2026-10-30", playedDates: WEEK_PLAYED });
    expect(weekdayRestProgress(sunday, "2026-11-01")).toBeNull();
    expect(
      weekdayRestProgress({ ...sunday, lastCompletedDate: "2026-11-01", playedDates: [...WEEK_PLAYED, "2026-11-01"] }, "2026-11-01")
    ).toBeNull();
  });
});

describe("restDayProgress", () => {
  it("counts down the plays the weekend off still needs while the week has room", () => {
    // Monday played: two more of the four weekdays left.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-26"] }), "2026-10-26")).toEqual({
      saturday: "2026-10-31",
      needed: 2,
      sundayOnly: false,
    });
    // Thursday with one played: two needed, Friday and Saturday left, for Sunday.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-29"] }), "2026-10-29")).toEqual({
      saturday: "2026-10-31",
      needed: 2,
      sundayOnly: true,
    });
    // Friday with one played: two needed, one day left.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-30"] }), "2026-10-30")).toBeNull();
    // Earned.
    expect(restDayProgress(streakOf({ playedDates: WEEK_PLAYED }), "2026-10-30")).toEqual({
      saturday: "2026-10-31",
      needed: 0,
      sundayOnly: false,
    });
    // A Saturday played as the third has earned its Sunday.
    expect(
      restDayProgress(streakOf({ playedDates: ["2026-10-27", "2026-10-29", "2026-10-31"] }), "2026-10-31")
    ).toMatchObject({ saturday: "2026-10-31", needed: 0 });
    // A Saturday played short of three has nothing left to earn.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-31"] }), "2026-10-31")).toBeNull();
    // A Sunday played looks to the next week.
    expect(restDayProgress(streakOf({ playedDates: ["2026-11-01"] }), "2026-11-01")).toEqual({
      saturday: "2026-11-07",
      needed: 3,
      sundayOnly: false,
    });
    // Before rest days began.
    expect(restDayProgress(streakOf({ playedDates: ["2026-10-19"] }), "2026-10-19")).toBeNull();
  });
});

describe("saved freezes", () => {
  it("caps at none in the first two days, one from 3 days, two from 14", () => {
    expect([1, 2, 3, 13, 14, 27, 28, 365].map(freezeCap)).toEqual([0, 0, 1, 1, 2, 2, 2, 2]);
  });

  /** Play `days` days in a row from `start`, as storage does: advance the streak, then earn. */
  function play(start: StreakState, days: number): StreakState[] {
    const seen: StreakState[] = [];
    let s = start;
    for (let i = 0; i < days; i++) {
      const currentStreak = s.currentStreak + 1;
      s = earnFreeze({ ...s, currentStreak, longestStreak: Math.max(s.longestStreak, currentStreak) });
      seen.push(s);
    }
    return seen;
  }

  it("earns one every 4 days played, up to the cap", () => {
    const fresh = streakOf({ currentStreak: 0, longestStreak: 0 });
    const days = play(fresh, 21);
    // The first on day 4; then the cap of one is full until 14, which raises it.
    expect(days.map((d) => d.bankedFreezes ?? 0)).toEqual([
      0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
    ]);
    expect(days.map((d) => d.freezeDays)).toEqual([
      1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0,
    ]);
  });

  it("counts nothing at a full cap, and starts counting again once one is spent", () => {
    const full = streakOf({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2, freezeDays: 0 });
    expect(play(full, 5).map((d) => d.bankedFreezes)).toEqual([2, 2, 2, 2, 2]);
    const spent = { ...full, bankedFreezes: 1 };
    expect(play(spent, 4).map((d) => [d.bankedFreezes, d.freezeDays])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 0],
    ]);
  });

  it("counts days played, not the streak: a streak ending keeps the count", () => {
    const counted = streakOf({ currentStreak: 0, longestStreak: 20, bankedFreezes: 0, freezeDays: 3 });
    expect(earnFreeze({ ...counted, currentStreak: 1 })).toMatchObject({ bankedFreezes: 1, freezeDays: 0 });
  });

  it("waits a day short of a freeze until the player's longest streak can hold one", () => {
    const short = streakOf({ currentStreak: 1, longestStreak: 2, bankedFreezes: 0, freezeDays: 3 });
    expect(earnFreeze(short)).toMatchObject({ bankedFreezes: 0, freezeDays: 3 });
  });

  it("keeps three held from the old cap, earning no more", () => {
    const old = streakOf({ currentStreak: 42, longestStreak: 42, bankedFreezes: 3 });
    expect(earnFreeze(old)).toMatchObject({ bankedFreezes: 3, freezeDays: 0 });
  });

  it("starts a streak saved before days were counted near its next freeze", () => {
    // Day 12 of a streak, none held: counted as 3, so day 13 earns one.
    const before = streakOf({ currentStreak: 13, longestStreak: 13, bankedFreezes: 0 });
    expect(earnFreeze(before)).toMatchObject({ bankedFreezes: 1, freezeDays: 0 });
  });

  it("says how many days until the next one", () => {
    expect(daysToFreeze(streakOf({ currentStreak: 0, longestStreak: 0 }))).toBe(4);
    expect(daysToFreeze(streakOf({ currentStreak: 2, longestStreak: 2, freezeDays: 2 }))).toBe(2);
    // A full cap of one rises on day 14, which counts, then three more days.
    expect(daysToFreeze(streakOf({ currentStreak: 10, longestStreak: 10, bankedFreezes: 1 }))).toBe(7);
    expect(daysToFreeze(streakOf({ currentStreak: 30, longestStreak: 30, bankedFreezes: 2 }))).toBeNull();
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
    // A Saturday played names itself: its Sunday is still to rest.
    expect(streakReport({ ...thursday, lastCompletedDate: "2026-10-31" })?.restDay).toBe("2026-10-31");
    // So does a Saturday played as the third, which earned only the Sunday.
    expect(
      streakReport(
        streakOf({ lastCompletedDate: "2026-10-31", playedDates: ["2026-10-27", "2026-10-29", "2026-10-31"] })
      )?.restDay
    ).toBe("2026-10-31");
    // A Sunday played ends its week, with nothing of its weekend left to rest.
    expect(streakReport({ ...thursday, lastCompletedDate: "2026-11-01" })?.restDay).toBeUndefined();
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

describe("freezeProgress", () => {
  it("counts the days played towards the next freeze, out of 4", () => {
    expect(freezeProgress(streakOf({ currentStreak: 0, freezeDays: 0 }))).toEqual({ played: 0, of: 4 });
    expect(freezeProgress(streakOf({ freezeDays: 3 }))).toEqual({ played: 3, of: 4 });
    // Saved before days were counted: the streak, up to a day short.
    expect(freezeProgress(streakOf({ currentStreak: 2, longestStreak: 2 }))).toEqual({ played: 2, of: 4 });
    expect(freezeProgress(streakOf({ bankedFreezes: 0 }))).toEqual({ played: 3, of: 4 });
  });
});
