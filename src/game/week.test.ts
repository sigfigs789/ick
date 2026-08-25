import { describe, expect, it } from "vitest";
import { daysUntilReset, resetLabel, weekStart } from "./week";

describe("weekly board window", () => {
  it("starts the week on Monday", () => {
    // 2026-08-24 is a Monday.
    expect(weekStart("2026-08-24")).toBe("2026-08-24");
    expect(weekStart("2026-08-25")).toBe("2026-08-24");
    expect(weekStart("2026-08-27")).toBe("2026-08-24");
  });

  it("keeps Sunday in the week that preceded it", () => {
    // 2026-08-30 is a Sunday: it ends the week that began on the 24th.
    expect(weekStart("2026-08-30")).toBe("2026-08-24");
    expect(weekStart("2026-08-31")).toBe("2026-08-31");
  });

  it("crosses a month and a year boundary", () => {
    // 2026-09-01 is a Tuesday, so its week began in August.
    expect(weekStart("2026-09-01")).toBe("2026-08-31");
    // 2027-01-01 is a Friday, so its week began in December.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  it("counts the days left including today", () => {
    expect(daysUntilReset("2026-08-24")).toBe(7); // Monday
    expect(daysUntilReset("2026-08-29")).toBe(2); // Saturday
    expect(daysUntilReset("2026-08-30")).toBe(1); // Sunday
  });

  it("says when the board resets", () => {
    expect(resetLabel("2026-08-30")).toBe("Resets tonight");
    expect(resetLabel("2026-08-25")).toBe("Resets in 6 days");
  });
});
