import { beforeEach, describe, expect, it } from "vitest";
import {
  congratsMessage,
  congratsPopped,
  congratsSpot,
  markCongratsPopped,
} from "./congrats";

describe("which win a day congratulates", () => {
  it("names last week's winner on a Tuesday", () => {
    // 2026-09-15 is a Tuesday. Its own week began on the 13th, so the week that
    // closed is the one that began nine days earlier.
    expect(congratsSpot("2026-09-15")).toEqual({
      window: "week",
      start: "2026-09-06",
    });
  });

  it("says nothing on any other weekday", () => {
    // Sunday through Saturday of one week, minus its Tuesday. A window has just
    // closed on the Sunday too, and it is deliberately quiet there: a board is
    // still moving at the boundary.
    for (const date of [
      "2026-09-13",
      "2026-09-14",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]) {
      expect(congratsSpot(date)).toBeNull();
    }
  });

  it("names last month's winner on the second", () => {
    expect(congratsSpot("2026-10-02")).toEqual({
      window: "month",
      start: "2026-09-01",
    });
    // Across a year boundary, the one case a month's arithmetic could get wrong.
    expect(congratsSpot("2027-01-02")).toEqual({
      window: "month",
      start: "2026-12-01",
    });
  });

  it("gives the month the day when the second falls on a Tuesday", () => {
    // 2026-12-02 is a Wednesday; 2027-02-02 is a Tuesday, where both rules fire
    // and the larger result takes it.
    expect(congratsSpot("2027-02-02")).toEqual({
      window: "month",
      start: "2027-01-01",
    });
  });
});

describe("what the bubble says", () => {
  it("names the player and the window", () => {
    expect(
      congratsMessage("StormyFox47", { window: "week", start: "2026-09-06" }),
    ).toBe("Congrats StormyFox47 for last week's win");
    expect(
      congratsMessage("StormyFox47", { window: "month", start: "2026-09-01" }),
    ).toBe("Congrats StormyFox47 on September's win");
  });
});

describe("popping a bubble", () => {
  beforeEach(() => localStorage.clear());

  it("keeps one window's bubble popped without touching the next", () => {
    const week = { window: "week", start: "2026-09-06" } as const;
    const nextWeek = { window: "week", start: "2026-09-13" } as const;
    expect(congratsPopped(week)).toBe(false);
    markCongratsPopped(week);
    expect(congratsPopped(week)).toBe(true);
    // The following week's congratulation is a different one, and has not been
    // met -- which is the whole reason the key carries the window it is about.
    expect(congratsPopped(nextWeek)).toBe(false);
  });

  it("keeps the week and the month apart", () => {
    const week = { window: "week", start: "2026-09-06" } as const;
    const month = { window: "month", start: "2026-09-06" } as const;
    markCongratsPopped(week);
    expect(congratsPopped(month)).toBe(false);
  });
});
