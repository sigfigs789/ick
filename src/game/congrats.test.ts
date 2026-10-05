import { beforeEach, describe, expect, it } from "vitest";
import {
  congratsMessage,
  congratsPopped,
  congratsSpots,
  markCongratsPopped,
  pendingCongratsSpot,
  pendingCongratsSpots,
  wanderPath,
} from "./congrats";

/** A word banked on `date`'s puzzle, which is what makes a player not new. */
function playedOn(date: string) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({ date, acceptedWords: [{ word: "quixotic" }] }),
  );
}

describe("which win a day congratulates", () => {
  beforeEach(() => {
    localStorage.clear();
    // Around since the summer, so every month in these tests is one they saw.
    playedOn("2026-07-15");
  });

  it("names last week's winner from the Monday to the Thursday", () => {
    // The week of the 13th: its Monday is the 14th, so the week that closed is
    // the one that began eight days before that.
    for (const date of ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]) {
      expect(pendingCongratsSpot(date)).toEqual({
        window: "week",
        start: "2026-09-06",
        mode: "standard",
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
    const month = { window: "month", start: "2026-10-01", mode: "standard" } as const;
    const freeformMonth = { ...month, mode: "freeform" } as const;
    expect(pendingCongratsSpot("2026-11-02")).toEqual(month);

    // Popping the larger result does not swallow the smaller ones: the month's
    // Freeform winner is next, then the week's two.
    markCongratsPopped(month);
    expect(pendingCongratsSpot("2026-11-02")).toEqual(freeformMonth);
    markCongratsPopped(freeformMonth);
    expect(pendingCongratsSpots("2026-11-02")).toEqual([
      { window: "week", start: "2026-10-25", mode: "standard" },
      { window: "week", start: "2026-10-25", mode: "freeform" },
    ]);
  });

  it("names a Freeform winner for every window that reached the split", () => {
    // 2026-10-12 is a Monday; the week that closed began on the 4th.
    expect(congratsSpots("2026-10-12")).toEqual([
      { window: "week", start: "2026-10-04", mode: "standard" },
      { window: "week", start: "2026-10-04", mode: "freeform" },
    ]);
    // The week the choice opened on is the first with a Freeform board, owed
    // from the Monday after it.
    expect(congratsSpots("2026-10-06").map((s) => s.mode)).toEqual([
      "standard",
      "freeform",
    ]);
    // September ended after the split, so it has two winners too.
    expect(
      congratsSpots("2026-10-02")
        .filter((s) => s.window === "month")
        .map((s) => s.mode),
    ).toEqual([
      "standard",
      "freeform",
    ]);
  });

  it("keeps a month's win from a player who was not around for it", () => {
    localStorage.clear();
    // 2026-11-02 owes October's month and the last week of it. A player whose
    // first puzzle was today's is told about the week only.
    playedOn("2026-11-02");
    expect(pendingCongratsSpots("2026-11-02").map((s) => s.window)).toEqual([
      "week",
      "week",
    ]);
    // One word banked in October is enough to have been there for it.
    playedOn("2026-10-30");
    expect(pendingCongratsSpots("2026-11-02").map((s) => s.window)).toEqual([
      "month",
      "month",
      "week",
      "week",
    ]);
  });

  it("names only one winner for a window that closed before the split", () => {
    // One board then, so a Freeform winner would be the Standard one twice.
    expect(congratsSpots("2026-09-21")).toEqual([
      { window: "week", start: "2026-09-13", mode: "standard" },
    ]);
    // The Monday of the split week still congratulates the week before it.
    expect(congratsSpots("2026-09-28")).toEqual([
      { window: "week", start: "2026-09-20", mode: "standard" },
    ]);
    expect(congratsSpots("2026-09-02").filter((s) => s.window === "month")).toEqual([
      { window: "month", start: "2026-08-01", mode: "standard" },
    ]);
  });

  it("stays gone for the rest of the run once it is popped", () => {
    const week = { window: "week", start: "2026-09-06", mode: "standard" } as const;
    markCongratsPopped(week);
    // The Tuesday, Wednesday and Thursday of a run whose Monday was splatted.
    for (const date of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
      expect(pendingCongratsSpot(date)).toBeNull();
    }
  });
});

describe("what the bubble says", () => {
  it("names the player, the window and the mode", () => {
    expect(
      congratsMessage("StormyFox47", { window: "week", start: "2026-09-06", mode: "standard" }),
    ).toBe("Congrats StormyFox47 for last week's Standard win");
    expect(
      congratsMessage("StormyFox47", { window: "month", start: "2026-09-01", mode: "freeform" }),
    ).toBe("Congrats StormyFox47 on September's Freeform win");
  });
});

describe("where a bubble wanders", () => {
  it("draws five stops inside the room the bubble has", () => {
    const path = wanderPath();
    expect(path).toHaveLength(5);
    for (const stop of path) {
      expect(stop.x).toBeGreaterThanOrEqual(-1);
      expect(stop.x).toBeLessThanOrEqual(1);
      expect(stop.y).toBeGreaterThanOrEqual(0);
      expect(stop.y).toBeLessThanOrEqual(1);
    }
  });

  it("spawns each bubble somewhere of its own", () => {
    const values = [0.1, 0.9, 0.4, 0.6];
    let at = 0;
    const random = () => values[at++ % values.length];
    expect(wanderPath(random)[0]).not.toEqual(wanderPath(random)[0]);
  });
});

describe("popping a bubble", () => {
  beforeEach(() => localStorage.clear());

  it("keeps one window's bubble popped without touching the next", () => {
    const week = { window: "week", start: "2026-09-06", mode: "standard" } as const;
    const nextWeek = { window: "week", start: "2026-09-13", mode: "standard" } as const;
    expect(congratsPopped(week)).toBe(false);
    markCongratsPopped(week);
    expect(congratsPopped(week)).toBe(true);
    // The following week's congratulation is a different one, and has not been
    // met -- which is the whole reason the key carries the window it is about.
    expect(congratsPopped(nextWeek)).toBe(false);
  });

  it("keeps the week and the month apart", () => {
    const week = { window: "week", start: "2026-09-06", mode: "standard" } as const;
    const month = { window: "month", start: "2026-09-06", mode: "standard" } as const;
    markCongratsPopped(week);
    expect(congratsPopped(month)).toBe(false);
  });

  it("keeps Standard and Freeform apart", () => {
    const standard = { window: "week", start: "2026-10-04", mode: "standard" } as const;
    markCongratsPopped(standard);
    expect(congratsPopped({ ...standard, mode: "freeform" })).toBe(false);
  });

  it("still honours a Standard bubble popped before there were two", () => {
    // The key Standard was stored under before modes reached the bubble.
    localStorage.setItem("ick:congrats:week:2026-09-27", "1");
    expect(
      congratsPopped({ window: "week", start: "2026-09-27", mode: "standard" }),
    ).toBe(true);
  });
});
