import { describe, expect, it } from "vitest";
import { weekChampionSettling, weekEnd, weekLabel, weekStart } from "./week";

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

  it("calls last week's champion unsettled for the whole of Sunday and no longer", () => {
    // The window the plaque names closes at each player's own midnight, so on
    // Sunday it is still closing somewhere and the winner can still change --
    // which is the day the plaque names the winner with the caveat beside it.
    expect(weekChampionSettling("2026-08-30")).toBe(true);
    // Monday morning every clock on earth has left Saturday, and every reader
    // gets the same answer, so the caveat comes off.
    expect(weekChampionSettling("2026-08-31")).toBe(false);
    // And no other day of the week carries it: the window closed days ago.
    for (const day of [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]) {
      expect(weekChampionSettling(day)).toBe(false);
    }
    // Saturday least of all -- the week being named is still being played.
    expect(weekChampionSettling("2026-09-05")).toBe(false);
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
