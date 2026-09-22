import { beforeEach, describe, expect, it } from "vitest";
import {
  congratsMessage,
  congratsPopped,
  congratsSpots,
  markCongratsPopped,
  pendingCongratsSpot,
} from "./congrats";

describe("which win a day congratulates", () => {
  beforeEach(() => localStorage.clear());

  it("names last week's winner from the Monday to the Thursday", () => {
    // The week of the 13th: its Monday is the 14th, so the week that closed is
    // the one that began eight days before that.
    for (const date of ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]) {
      expect(pendingCongratsSpot(date)).toEqual({
        window: "week",
        start: "2026-09-06",
      });
    }
  });

  it("says nothing on the days either side of that run", () => {
    // The Sunday a window has just closed on, which is deliberately quiet --
    // the board is still moving at the boundary -- and the Friday and Saturday,
    // by which point the result is old news said late.
    for (const date of ["2026-09-13", "2026-09-18", "2026-09-19"]) {
      expect(pendingCongratsSpot(date)).toBeNull();
    }
  });

  it("names last month's winner from the second to the fifth", () => {
    for (const date of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
      expect(pendingCongratsSpot(date)).toMatchObject({
        window: "month",
        start: "2026-09-01",
      });
    }
    // Across a year boundary, the one case a month's arithmetic could get wrong.
    expect(pendingCongratsSpot("2027-01-02")).toMatchObject({
      window: "month",
      start: "2026-12-01",
    });
    // And not on the first, when the month has only just shut, nor on the sixth.
    expect(congratsSpots("2026-10-01").some((s) => s.window === "month")).toBe(false);
    expect(congratsSpots("2026-10-06").some((s) => s.window === "month")).toBe(false);
  });

  it("offers the month first when both are owed, and the week once it is popped", () => {
    // 2026-11-02 is a Monday, where both runs begin on the same day.
    const month = { window: "month", start: "2026-10-01" } as const;
    expect(pendingCongratsSpot("2026-11-02")).toEqual(month);

    // Popping the larger result does not swallow the smaller one: the week is
    // still owed, and is what the bubble carries next.
    markCongratsPopped(month);
    expect(pendingCongratsSpot("2026-11-02")).toEqual({
      window: "week",
      start: "2026-10-25",
    });
  });

  it("stays gone for the rest of the run once it is popped", () => {
    const week = { window: "week", start: "2026-09-06" } as const;
    markCongratsPopped(week);
    // The Tuesday, Wednesday and Thursday of a run whose Monday was splatted.
    for (const date of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
      expect(pendingCongratsSpot(date)).toBeNull();
    }
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
