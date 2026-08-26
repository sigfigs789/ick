import { describe, expect, it } from "vitest";
import { weekStart } from "./week";

describe("weekly board window", () => {
  it("starts the week on Sunday", () => {
    // 2026-08-23 is a Sunday.
    expect(weekStart("2026-08-23")).toBe("2026-08-23");
    expect(weekStart("2026-08-24")).toBe("2026-08-23");
    expect(weekStart("2026-08-27")).toBe("2026-08-23");
  });

  it("keeps Saturday in the week that preceded it", () => {
    // 2026-08-29 is a Saturday: it ends the week that began on the 23rd. The
    // next day starts a fresh one, which is the whole point of a Sunday reset --
    // a weekend arrival can still land on an open board.
    expect(weekStart("2026-08-29")).toBe("2026-08-23");
    expect(weekStart("2026-08-30")).toBe("2026-08-30");
  });

  it("crosses a month and a year boundary", () => {
    // 2026-09-01 is a Tuesday, so its week began in August.
    expect(weekStart("2026-09-01")).toBe("2026-08-30");
    // 2027-01-01 is a Friday, so its week began in December.
    expect(weekStart("2027-01-01")).toBe("2026-12-27");
  });

  it("puts one weekend day on a fresh board, which Monday weeks cannot", () => {
    // The onboarding argument for Sunday, asserted rather than left in a
    // comment: of the two weekend days, one is the first day of its week.
    const saturday = "2026-08-29";
    const sunday = "2026-08-30";
    expect(weekStart(sunday)).toBe(sunday);
    expect(weekStart(saturday)).not.toBe(saturday);
  });
});
