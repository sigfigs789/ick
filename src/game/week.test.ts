import { describe, expect, it } from "vitest";
import {
  MONDAY_WEEKS_START,
  nextWeek,
  previousWeek,
  weekEnd,
  weekLabel,
  weekResetLabel,
  weekStart,
} from "./week";

describe("weekly board window", () => {
  it("started the week on Sunday before the change", () => {
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
    // 2027-01-01 is a Friday, so its Monday week began in December.
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
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

describe("moving to Monday weeks", () => {
  it("ends the last Sunday week on Saturday 2026-10-24", () => {
    expect(weekStart("2026-10-24")).toBe("2026-10-18");
    expect(weekEnd("2026-10-18")).toBe("2026-10-24");
  });

  it("folds the Sunday left over into the first Monday week, which runs eight days", () => {
    for (const date of ["2026-10-25", "2026-10-26", "2026-10-28", "2026-11-01"]) {
      expect(weekStart(date)).toBe(MONDAY_WEEKS_START);
    }
    expect(weekEnd(MONDAY_WEEKS_START)).toBe("2026-11-01");
  });

  it("starts the week on Monday after that, keeping Sunday in the week before it", () => {
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-07")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekEnd("2026-11-02")).toBe("2026-11-08");
  });

  it("steps across the change a whole week at a time", () => {
    expect(previousWeek("2026-11-09")).toBe("2026-11-02");
    expect(previousWeek("2026-11-02")).toBe(MONDAY_WEEKS_START);
    expect(previousWeek(MONDAY_WEEKS_START)).toBe("2026-10-18");
    expect(nextWeek("2026-10-18")).toBe(MONDAY_WEEKS_START);
    expect(nextWeek(MONDAY_WEEKS_START)).toBe("2026-11-02");
    expect(nextWeek("2026-11-02")).toBe("2026-11-09");
  });

  it("says the week resets on Sundays until the change, then Mondays", () => {
    expect(weekResetLabel("2026-10-24")).toBe("Resets on Sundays");
    expect(weekResetLabel("2026-10-25")).toBe("Resets on Mondays");
  });
});

describe("naming a week the reader stepped back to", () => {
  it("closes a week on its own Saturday", () => {
    expect(weekEnd("2026-08-23")).toBe("2026-08-29");
    // Across a month boundary, which is the case that would need a table of
    // month lengths if this did its own arithmetic.
    expect(weekEnd("2026-08-30")).toBe("2026-09-05");
  });

  it("names a past week by the Sunday it started on", () => {
    // The Sunday alone: a week is seven days from one everywhere in this game,
    // so naming both ends spells out the half a reader can already do.
    expect(weekLabel("2026-08-16")).toBe("Week of Aug 16");
  });
});
