import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import type { AcceptedWord, DailyProgress, Rarity } from "./types";

function word(w: string, rarity: Rarity, zipf: number): AcceptedWord {
  return { word: w, rarity, zipf };
}

function day(
  date: string,
  acceptedWords: AcceptedWord[],
  extra: Partial<DailyProgress> = {}
): DailyProgress {
  return { date, drop: "ink", acceptedWords, rejectedAttempts: [], completed: true, ...extra };
}

const streak = { currentStreak: 2, longestStreak: 5 };

describe("computeStats", () => {
  const history = [
    day("2026-10-20", [word("inkling", "Rare", 2.6), word("think", "Common", 5.2)], {
      mode: "standard",
    }),
    day("2026-10-21", [word("pink", "Common", 4.8)], { mode: "standard" }),
    day("2026-10-21", [word("inkhorn", "Mythic", 0.5)], { mode: "freeform" }),
    day("2026-10-22", [word("ink", "Common", 4.5)], { mode: "standard", completed: false }),
  ];

  it("counts days, words and finished puzzles", () => {
    const stats = computeStats(history, streak);
    expect(stats.daysPlayed).toBe(3);
    expect(stats.wordsFound).toBe(5);
    expect(stats.finished).toBe(3);
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(5);
  });

  it("tallies each tier", () => {
    const { byRarity } = computeStats(history, streak);
    expect(byRarity).toEqual({ Rare: 1, Common: 3, Mythic: 1 });
  });

  it("lists the best words rarest first, and the longest word", () => {
    const stats = computeStats(history, streak);
    expect(stats.topWords.map((w) => w.word)).toEqual(["inkhorn", "inkling", "ink", "pink", "think"]);
    expect(stats.topWords[0].mode).toBe("freeform");
    expect(stats.longestWord?.word).toBe("inkling");
  });

  it("splits by mode, averaging finished puzzles only", () => {
    const { modes } = computeStats(history, streak);
    expect(modes.map((m) => [m.mode, m.puzzles])).toEqual([
      ["standard", 3],
      ["freeform", 1],
    ]);
    // The unfinished day is played but not averaged.
    expect(modes[0].average).not.toBeNull();
    expect(modes[0].best).toBeGreaterThanOrEqual(modes[0].average!);
  });

  it("has no average before anything is finished", () => {
    const stats = computeStats([day("2026-10-22", [word("ink", "Common", 4.5)], { completed: false })], streak);
    expect(stats.finished).toBe(0);
    expect(stats.modes[0].average).toBeNull();
  });
});
