import { describe, expect, it } from "vitest";
import { daysSinceEpoch, previousMonthName, toDateString } from "./date";

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

describe("previousMonthName", () => {
  it("names the month before the one a date falls in", () => {
    expect(previousMonthName("2026-08-26")).toBe("July");
    // The first of a month still belongs to that month, so the answer does not
    // move on the boundary.
    expect(previousMonthName("2026-08-01")).toBe("July");
  });

  it("rolls back into the year before from January", () => {
    expect(previousMonthName("2026-01-04")).toBe("December");
  });
});
