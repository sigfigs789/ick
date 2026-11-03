import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { totalRarityScore } from "./dictionary";
import { markBestWeekCelebrated, MIN_BEST_DAY, MIN_BEST_WEEK, personalBestOn } from "./personalBest";
import type { AcceptedWord } from "./types";

/** A Thursday: its week runs Monday 2026-11-09 to Sunday 2026-11-15. */
const TODAY = "2026-11-12";

// Four words at one Zipf. Lower is rarer: at these dates 2 → 35.48 a day,
// 3 → 30.04, 3.5 → 27.28, 4 → 24.48.
function words(zipf: number): AcceptedWord[] {
  return ["a", "b", "c", "d"].map((word) => ({ word, rarity: "Common", zipf }));
}

/** A day played on its own date, Standard unless `freeform`. */
function store(date: string, zipf: number, { completed = true, freeform = false } = {}) {
  localStorage.setItem(
    `ick:progress:${date}${freeform ? ":freeform" : ""}`,
    JSON.stringify({
      date,
      drop: "ink",
      acceptedWords: words(zipf),
      rejectedAttempts: [],
      completed,
      firstWordAt: `${date}T12:00:00`,
      completedAt: completed ? `${date}T12:30:00` : undefined,
    })
  );
}

const day = (date: string, zipf: number) => totalRarityScore(words(zipf), date);
const best = (date = TODAY) => personalBestOn(date, "standard");

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T18:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the best day ever", () => {
  it("is the finish that beats every earlier day, from MIN_BEST_DAY up", () => {
    expect(day(TODAY, 3)).toBeGreaterThanOrEqual(MIN_BEST_DAY);
    store("2026-11-10", 3.5);
    store(TODAY, 3);
    expect(best()).toEqual({ kind: "day", score: day(TODAY, 3), previous: day("2026-11-10", 3.5) });
  });

  it("is not one below MIN_BEST_DAY, however it compares", () => {
    expect(day(TODAY, 3.5)).toBeLessThan(MIN_BEST_DAY);
    store("2026-11-10", 4);
    store(TODAY, 3.5);
    expect(best()).toBeNull();
  });

  it("is not one that only ties", () => {
    store("2026-11-10", 3);
    store(TODAY, 3);
    expect(best()).toBeNull();
  });

  it("needs an earlier day to beat", () => {
    store(TODAY, 2);
    expect(best()).toBeNull();
  });

  it("waits for the finish", () => {
    store("2026-11-10", 3.5);
    store(TODAY, 3, { completed: false });
    expect(best()).toBeNull();
  });

  it("is kept to today's board: a Freeform day is no Standard record to beat", () => {
    store("2026-11-10", 3.5);
    store("2026-11-11", 1, { freeform: true });
    store(TODAY, 3);
    expect(best()?.kind).toBe("day");
  });
});

describe("the best week ever", () => {
  /** Last week's four days, at `zipf`. */
  function lastWeek(zipf: number) {
    ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].forEach((date) => store(date, zipf));
  }
  /** This week's Monday to Wednesday, at `zipf`. */
  function thisWeek(zipf: number) {
    ["2026-11-09", "2026-11-10", "2026-11-11"].forEach((date) => store(date, zipf));
  }

  it("is the finish that takes the week's best four past every earlier week, from MIN_BEST_WEEK up", () => {
    lastWeek(3.5);
    thisWeek(3);
    store(TODAY, 3);
    const score = 4 * day(TODAY, 3);
    expect(score).toBeGreaterThanOrEqual(MIN_BEST_WEEK);
    expect(best()).toEqual({ kind: "week", score, previous: 4 * day("2026-11-02", 3.5) });
  });

  it("goes ahead of the best day when one finish sets both", () => {
    lastWeek(3.5);
    thisWeek(3);
    store(TODAY, 2);
    expect(best()?.kind).toBe("week");
  });

  it("is not one below MIN_BEST_WEEK", () => {
    lastWeek(4);
    thisWeek(3.5);
    store(TODAY, 3.5);
    expect(best()).toBeNull();
  });

  it("needs an earlier week to beat", () => {
    thisWeek(3);
    store(TODAY, 3);
    expect(best()).toBeNull();
  });

  it("is not set by a day outside the week's best four", () => {
    lastWeek(3.5);
    store("2026-11-09", 2);
    store("2026-11-10", 2);
    store("2026-11-11", 2);
    store(TODAY, 2);
    // Friday's low day leaves the week where Thursday took it.
    store("2026-11-13", 4);
    vi.setSystemTime(new Date("2026-11-13T18:00:00"));
    expect(best("2026-11-13")).toBeNull();
  });

  it("is celebrated once a week, leaving the best day to a later finish", () => {
    lastWeek(3.5);
    thisWeek(3);
    store(TODAY, 2);
    markBestWeekCelebrated("2026-11-10");
    expect(best()).toEqual({ kind: "day", score: day(TODAY, 2), previous: day("2026-11-09", 3) });
  });
});
