import { describe, expect, it } from "vitest";
import { completedWholeMonth, perfectMonthName } from "./perfectMonth";
import type { StreakState } from "./types";

function streakOf(currentStreak: number, lastCompletedDate?: string): StreakState {
  return {
    currentStreak,
    longestStreak: currentStreak,
    lastCompletedDate,
    totalCompleted: 0,
    crushedIt: 0,
    elite: 0,
    highScore: 0,
  };
}

describe("completedWholeMonth", () => {
  it("is earned on the last day by a streak reaching back to the first", () => {
    expect(completedWholeMonth(streakOf(30, "2026-09-30"), "2026-09-30")).toBe(true);
    // A streak that began last month still covers every day of this one.
    expect(completedWholeMonth(streakOf(45, "2026-09-30"), "2026-09-30")).toBe(true);
    expect(completedWholeMonth(streakOf(31, "2026-10-31"), "2026-10-31")).toBe(true);
  });

  it("is not earned with a day missing", () => {
    expect(completedWholeMonth(streakOf(29, "2026-09-30"), "2026-09-30")).toBe(false);
  });

  it("is only earned on the last day of the month", () => {
    expect(completedWholeMonth(streakOf(29, "2026-09-29"), "2026-09-29")).toBe(false);
    expect(completedWholeMonth(streakOf(40, "2026-10-01"), "2026-10-01")).toBe(false);
  });

  it("waits for today's puzzle to be played", () => {
    // Yesterday's streak, on the last day before its first word is in.
    expect(completedWholeMonth(streakOf(29, "2026-09-29"), "2026-09-30")).toBe(false);
  });

  it("knows the length of February, leap year or not", () => {
    expect(completedWholeMonth(streakOf(28, "2027-02-28"), "2027-02-28")).toBe(true);
    expect(completedWholeMonth(streakOf(28, "2028-02-28"), "2028-02-28")).toBe(false);
    expect(completedWholeMonth(streakOf(29, "2028-02-29"), "2028-02-29")).toBe(true);
  });

  it("rolls December into the next year", () => {
    expect(completedWholeMonth(streakOf(31, "2026-12-31"), "2026-12-31")).toBe(true);
  });
});

describe("perfectMonthName", () => {
  it("names the month the date falls in", () => {
    expect(perfectMonthName("2026-09-30")).toBe(
      new Date("2026-09-30T00:00:00").toLocaleDateString(undefined, { month: "long" })
    );
  });
});
