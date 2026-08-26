import { describe, expect, it } from "vitest";
import { daysUntilReset, resetLabel, weekEnd, weekRange, weekStart } from "./week";

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

  it("counts the days left including today", () => {
    expect(daysUntilReset("2026-08-23")).toBe(7); // Sunday
    expect(daysUntilReset("2026-08-28")).toBe(2); // Friday
    expect(daysUntilReset("2026-08-29")).toBe(1); // Saturday
  });

  it("closes the week on the Saturday", () => {
    expect(weekEnd("2026-08-23")).toBe("2026-08-29"); // Sunday
    expect(weekEnd("2026-08-27")).toBe("2026-08-29"); // Thursday
    expect(weekEnd("2026-08-29")).toBe("2026-08-29"); // Saturday itself
  });

  it("names the week by its days, and repeats the month only when it changes", () => {
    // What the heading shows beside "This week". Repeating "Aug" on both sides
    // of a range inside one month makes it read as two dates rather than one
    // window.
    expect(weekRange("2026-08-27")).toBe("Aug 23 – 29");
    // A week that crosses a month has to say both.
    expect(weekRange("2026-09-02")).toBe("Aug 30 – Sep 5");
    // And one that crosses a year.
    expect(weekRange("2026-12-31")).toBe("Dec 27 – Jan 2");
  });

  it("says when the board resets", () => {
    expect(resetLabel("2026-08-29")).toBe("Resets tonight");
    expect(resetLabel("2026-08-24")).toBe("Resets in 6 days");
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
