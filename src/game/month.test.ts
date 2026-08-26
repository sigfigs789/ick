import { describe, expect, it } from "vitest";
import { monthResetLabel, monthStart, nextMonthStart } from "./month";

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

  it("says the day it resets, and no range", () => {
    // What the season's "Aug 1 – Dec 31 2026" was replaced with: one date, the
    // day the board turns over, and it is the same sentence all month.
    expect(monthResetLabel("2026-08-26")).toBe("Resets Sep 1");
    expect(monthResetLabel("2026-08-01")).toBe("Resets Sep 1");
    expect(monthResetLabel("2026-12-31")).toBe("Resets Jan 1");
  });
});
