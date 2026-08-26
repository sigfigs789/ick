import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rarityScore } from "./dictionary";
import { windowTotals } from "./totals";
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
});

function round(total: number): number {
  return Math.round(total * 10) / 10;
}
