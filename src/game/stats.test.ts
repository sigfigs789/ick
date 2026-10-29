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

  it("breaks a tied score newest first", () => {
    const stats = computeStats(
      [day("2026-10-20", [word("pink", "Common", 4.8)]), day("2026-10-22", [word("kink", "Common", 4.8)])],
      streak
    );
    expect(stats.topWords.map((w) => w.word)).toEqual(["kink", "pink"]);
  });



  it("keeps legacy-scored puzzles out of the best words", () => {
    // Before 2026-08-15 the page has no legacy data, so "think" would show as 52.
    const early = day("2026-08-01", [word("think", "Common", 5.2)], { mode: "standard" });
    const stats = computeStats([early], streak);
    expect(stats.topWords).toEqual([]);
    expect(stats.daysPlayed).toBe(1);
    expect(stats.wordsFound).toBe(1);
    expect(stats.longestWord?.word).toBe("think");
  });
});
