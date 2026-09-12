import { afterEach, describe, expect, it } from "vitest";
import { daysSinceEpoch, setPuzzleDay, toDateString, todayDateString } from "./date";

describe("toDateString", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(toDateString(new Date(2024, 0, 15))).toBe("2024-01-15");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toDateString(new Date(2024, 2, 5))).toBe("2024-03-05");
  });
});

describe("daysSinceEpoch", () => {
  it("is 0 for the epoch date itself", () => {
    expect(daysSinceEpoch("2024-01-01", "2024-01-01")).toBe(0);
  });

  it("counts forward whole days", () => {
    expect(daysSinceEpoch("2024-01-02", "2024-01-01")).toBe(1);
    expect(daysSinceEpoch("2024-02-01", "2024-01-01")).toBe(31);
  });

  it("counts negative for dates before the epoch", () => {
    expect(daysSinceEpoch("2023-12-31", "2024-01-01")).toBe(-1);
  });

  it("is unaffected by DST transitions", () => {
    // Spring-forward/fall-back in the US shouldn't skew a plain day count.
    expect(daysSinceEpoch("2024-11-10", "2024-11-01")).toBe(9);
  });
});

describe("a host that fixes the puzzle day", () => {
  afterEach(() => {
    // Hand the day back to the clock, or every test after this one is on a
    // Tuesday in 2026.
    setPuzzleDay(null);
  });

  it("is not fixed by default, which is what this site relies on", () => {
    expect(todayDateString()).toBe(toDateString(new Date()));
  });

  it("answers with the day it was given", () => {
    setPuzzleDay("2026-07-08");
    expect(todayDateString()).toBe("2026-07-08");
  });

  it("hands the day back to the clock when cleared", () => {
    setPuzzleDay("2026-07-08");
    setPuzzleDay(null);
    expect(todayDateString()).toBe(toDateString(new Date()));
  });
});
