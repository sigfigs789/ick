import { describe, expect, it } from "vitest";
import {
  monthChampionSettling,
  monthResetLabel,
  monthStart,
  nextMonthStart,
} from "./month";

describe("monthly board window", () => {
  it("starts the month on the first", () => {
    expect(monthStart("2026-08-01")).toBe("2026-08-01");
    expect(monthStart("2026-08-26")).toBe("2026-08-01");
    expect(monthStart("2026-08-31")).toBe("2026-08-01");
  });

  it("moves the window on the first, which is the whole of the reset", () => {
    // Nothing runs at the boundary: the last day of one month and the first of
    // the next ask for different windows, so August's scores fall off the board
    // by themselves the moment September's puzzle is the one being played.
    expect(monthStart("2026-08-31")).not.toBe(monthStart("2026-09-01"));
    expect(monthStart("2026-09-01")).toBe("2026-09-01");
    expect(monthStart("2026-09-30")).toBe("2026-09-01");
  });

  it("resets on the first of the month after this one", () => {
    expect(nextMonthStart("2026-08-26")).toBe("2026-09-01");
    // A short month is still the first of the next one.
    expect(nextMonthStart("2026-09-30")).toBe("2026-10-01");
    // December rolls the year rather than reaching month thirteen.
    expect(nextMonthStart("2026-12-15")).toBe("2027-01-01");
  });

  it("names the weekday it resets on, then the date", () => {
    // What the season's "Aug 1 – Dec 31 2026" was replaced with: the day the
    // board turns over, and it is the same sentence all month. The weekday
    // leads because it is the half a player can act on -- "Sep 1" alone is a
    // date they have to go and place in their own week.
    // 2026-09-01 is a Tuesday.
    expect(monthResetLabel("2026-08-26")).toBe("Resets Tuesday, Sep 1");
    expect(monthResetLabel("2026-08-01")).toBe("Resets Tuesday, Sep 1");
    // 2027-01-01 is a Friday, so December's board names a day in the next year.
    expect(monthResetLabel("2026-12-31")).toBe("Resets Friday, Jan 1");
  });

  it("names the weekday of the reset day, not of the day being played", () => {
    // The trap this would fall into: reading the weekday off `date` rather than
    // off the first of the next month. Every day of August has to give the same
    // answer, and it is Tuesday all month.
    const august = ["2026-08-01", "2026-08-14", "2026-08-26", "2026-08-31"];
    for (const day of august) {
      expect(monthResetLabel(day)).toBe("Resets Tuesday, Sep 1");
    }
  });

  it("holds last month's champion for the whole of the first and no longer", () => {
    // The weekly board's rule, one window up -- see week.test.ts.
    expect(monthChampionSettling("2026-09-01")).toBe(true);
    expect(monthChampionSettling("2026-09-02")).toBe(false);
    // Held on the first of every month, including the ones a year turns on.
    expect(monthChampionSettling("2027-01-01")).toBe(true);
    // And on no other day, including the last one, when the month being named
    // is the one still being played.
    expect(monthChampionSettling("2026-09-30")).toBe(false);
  });
});
