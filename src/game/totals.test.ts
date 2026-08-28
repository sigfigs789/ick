import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rarityScore } from "./dictionary";
import { weekTotal } from "./totals";
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

describe("weekTotal", () => {
  // 2026-08-20 is a Thursday, so its week runs from Sunday the 16th.
  const words = [word("inkling", 2.6, "Rare"), word("strange", 4.1)];

  it("sums the days from the week's Sunday onward", () => {
    store("2026-08-16", words); // the week's Sunday
    store("2026-08-18", words);
    store("2026-08-20", words); // the puzzle being shared

    expect(weekTotal("2026-08-20")).toBe(
      round(
        scored("2026-08-16", words) +
          scored("2026-08-18", words) +
          scored("2026-08-20", words)
      )
    );
  });

  it("leaves out the Saturday before, which belongs to the week before", () => {
    store("2026-08-15", words); // Saturday
    store("2026-08-20", words);

    expect(weekTotal("2026-08-20")).toBe(round(scored("2026-08-20", words)));
  });

  it("ignores days after the puzzle, so an older result reads its own week", () => {
    store("2026-08-17", words);
    store("2026-08-20", words);

    expect(weekTotal("2026-08-17")).toBe(round(scored("2026-08-17", words)));
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

    expect(weekTotal("2026-08-20")).toBe(0);
  });

  it("reads the puzzle the clock is on when no date is given", () => {
    store("2026-08-20", words);

    expect(weekTotal()).toBe(weekTotal("2026-08-20"));
  });
});

function round(total: number): number {
  return Math.round(total * 10) / 10;
}
