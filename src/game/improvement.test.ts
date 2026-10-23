import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "./date";
import {
  averageImprovement,
  improvementCelebrationDue,
  improvementPercent,
  markImprovementCelebrated,
} from "./improvement";
import { totalRarityScore } from "./dictionary";
import type { AcceptedWord } from "./types";

const TODAY = "2026-08-20";

function words(zipf: number): AcceptedWord[] {
  return [
    { word: "a", rarity: "Common", zipf },
    { word: "b", rarity: "Common", zipf },
  ];
}

/** A day played on its own date. */
function store(date: string, zipf: number, completed = true) {
  localStorage.setItem(
    `ick:progress:${date}`,
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

/** `zipfs` oldest first, ending on TODAY. */
function history(zipfs: number[]) {
  zipfs.forEach((zipf, i) => store(addDays(TODAY, i - zipfs.length + 1), zipf));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T18:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("averageImprovement", () => {
  it("compares the last five days with the five before", () => {
    // Lower Zipf is rarer and scores higher.
    history([5, 5, 5, 5, 5, 3, 3, 3, 3, 3]);
    const rise = averageImprovement(TODAY);
    expect(rise).not.toBeNull();
    expect(rise!.days).toBe(5);
    // Each day scored at its own date, as the boards score it.
    const scoreOn = (back: number, zipf: number) =>
      totalRarityScore(words(zipf), addDays(TODAY, -back));
    const earlier = [9, 8, 7, 6, 5].map((back) => scoreOn(back, 5));
    const recent = [4, 3, 2, 1, 0].map((back) => scoreOn(back, 3));
    expect(rise!.earlier).toBeCloseTo(earlier.reduce((a, b) => a + b) / 5, 2);
    expect(rise!.recent).toBeCloseTo(recent.reduce((a, b) => a + b) / 5, 2);
    expect(improvementPercent(rise!)).toBeGreaterThan(0);
  });

  it("shrinks both halves for a shorter history, down to three days each", () => {
    history([5, 5, 5, 3, 3, 3]);
    expect(averageImprovement(TODAY)?.days).toBe(3);
  });

  it("says nothing before there are three days on each side", () => {
    history([5, 5, 3, 3, 3]);
    expect(averageImprovement(TODAY)).toBeNull();
  });

  it("says nothing when the average is flat or falling", () => {
    history([4, 4, 4, 4, 4, 4]);
    expect(averageImprovement(TODAY)).toBeNull();
    localStorage.clear();
    history([3, 3, 3, 5, 5, 5]);
    expect(averageImprovement(TODAY)).toBeNull();
  });

  it("waits for today's puzzle to be finished", () => {
    history([5, 5, 5, 3, 3, 3]);
    store(TODAY, 3, false);
    expect(averageImprovement(TODAY)).toBeNull();
    store(TODAY, 3, true);
    expect(averageImprovement(TODAY)).not.toBeNull();
  });

  it("counts an earlier day however many guesses it used", () => {
    history([5, 5, 5, 3, 3, 3]);
    store(addDays(TODAY, -5), 5, false);
    expect(averageImprovement(TODAY)?.days).toBe(3);
  });

  it("leaves out days played from the archive", () => {
    history([5, 5, 5, 3, 3, 3]);
    const late = addDays(TODAY, -5);
    const progress = JSON.parse(localStorage.getItem(`ick:progress:${late}`)!);
    progress.firstWordAt = `${TODAY}T09:00:00`;
    localStorage.setItem(`ick:progress:${late}`, JSON.stringify(progress));
    expect(averageImprovement(TODAY)).toBeNull();
  });
});

describe("improvementCelebrationDue", () => {
  it("allows one celebration a week", () => {
    expect(improvementCelebrationDue(TODAY)).toBe(true);
    markImprovementCelebrated(TODAY);
    expect(improvementCelebrationDue(TODAY)).toBe(false);
    expect(improvementCelebrationDue(addDays(TODAY, 6))).toBe(false);
    expect(improvementCelebrationDue(addDays(TODAY, 7))).toBe(true);
  });
});
