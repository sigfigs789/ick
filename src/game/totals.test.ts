import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rarityScore } from "./dictionary";
import { windowTotals } from "./totals";
import { MODE_CHOICE_START } from "./mode";
import type { AcceptedWord, Rarity } from "./types";

function word(w: string, zipf = 5, rarity: Rarity = "Common"): AcceptedWord {
  return { word: w, rarity, zipf };
}

/** A day played on its own date, which is the only kind either window counts. */
function store(date: string, words: AcceptedWord[]) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({
      date,
      drop: "ink",
      acceptedWords: words,
      rejectedAttempts: [],
      completed: true,
      firstWordAt: `${date}T12:00:00`,
      completedAt: `${date}T12:30:00`,
    })
  );
}

function scored(date: string, words: AcceptedWord[]): number {
  return words.reduce((sum, w) => sum + rarityScore(w.zipf, date), 0);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("windowTotals", () => {
  // 2026-08-20 is a Thursday, so its week runs from Sunday the 16th.
  const words = [word("inkling", 2.6, "Rare"), word("strange", 4.1)];

  it("sums the week from its Sunday and the month from its first", () => {
    store("2026-08-16", words); // the week's Sunday
    store("2026-08-20", words); // the puzzle being shared
    store("2026-08-13", words); // this month, previous week
    store("2026-07-31", words); // last month entirely

    const day = scored("2026-08-16", words);
    expect(windowTotals("2026-08-20")).toEqual({
      week: round(day + scored("2026-08-20", words)),
      month: round(day + scored("2026-08-20", words) + scored("2026-08-13", words)),
    });
  });

  it("leaves out the Saturday before the week and the last day of the month before", () => {
    store("2026-08-15", words); // Saturday, the week before
    store("2026-08-20", words);

    const totals = windowTotals("2026-08-20");
    expect(totals.week).toBe(round(scored("2026-08-20", words)));
    expect(totals.month).toBe(
      round(scored("2026-08-15", words) + scored("2026-08-20", words))
    );
  });

  it("ignores days after the puzzle, so an older result reads its own windows", () => {
    store("2026-08-17", words);
    store("2026-08-20", words);

    expect(windowTotals("2026-08-17").week).toBe(round(scored("2026-08-17", words)));
  });

  it("ignores archive play, which the boards do not count either", () => {
    localStorage.setItem(
      "ick:progress:2026-08-18",
      JSON.stringify({
        date: "2026-08-18",
        drop: "ink",
        acceptedWords: words,
        rejectedAttempts: [],
        completed: true,
        // Played two days late: eligible for neither window.
        firstWordAt: "2026-08-20T12:00:00",
        completedAt: "2026-08-20T12:30:00",
      })
    );

    expect(windowTotals("2026-08-20")).toEqual({ week: 0, month: 0 });
  });

  it("reads the puzzle the clock is on when no date is given", () => {
    store("2026-08-20", words);

    expect(windowTotals()).toEqual(windowTotals("2026-08-20"));
  });

  it("counts each board's own days and not the other's", () => {
    const day = MODE_CHOICE_START;
    vi.setSystemTime(new Date(`${day}T12:00:00`));
    // The same puzzle played both ways, as a browser that has been switching
    // holds it: one on the bare key, one on Freeform's.
    store(day, words);
    localStorage.setItem(
      `ick:progress:${day}:freeform`,
      JSON.stringify({
        date: day,
        drop: "ink",
        mode: "freeform",
        acceptedWords: words,
        rejectedAttempts: [],
        completed: true,
        firstWordAt: `${day}T12:00:00`,
        completedAt: `${day}T12:30:00`,
      })
    );

    // These numbers promise to agree with a board, and there is one per mode
    // from this date on. Counting both records would inflate whichever window
    // was asked for by exactly the other game's scores.
    const one = round(scored(day, words));
    expect(windowTotals(day, "standard")).toEqual({ week: one, month: one });
    expect(windowTotals(day, "freeform")).toEqual({ week: one, month: one });
  });

  it("counts a day from before the split on both boards", () => {
    // Everything before the choice date is on every board (see mode.boardFor),
    // so a player's month does not shrink because they moved the switch.
    const before = "2026-09-20";
    const day = MODE_CHOICE_START;
    vi.setSystemTime(new Date(`${day}T12:00:00`));
    store(before, words);

    const both = round(scored(before, words));
    expect(windowTotals(day, "standard").month).toBe(both);
    expect(windowTotals(day, "freeform").month).toBe(both);
  });
});

/** The hundredths the windows round to, matching `totalRarityScore`. */
function round(total: number): number {
  return Math.round(total * 100) / 100;
}
