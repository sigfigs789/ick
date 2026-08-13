import { describe, expect, it } from "vitest";
import { buildShareText, puzzleNumber } from "./share";
import dropData from "../data/drops.json";
import { rarityScore } from "./dictionary";
import type { AcceptedWord } from "./types";

describe("puzzleNumber", () => {
  it("is 1 on the epoch date", () => {
    expect(puzzleNumber(dropData.epoch)).toBe(1);
  });

  it("increments by 1 per day", () => {
    expect(puzzleNumber("2024-01-02")).toBe(puzzleNumber("2024-01-01") + 1);
  });
});

describe("buildShareText", () => {
  const words: AcceptedWord[] = [
    { word: "the", rarity: "Quotidian", zipf: 7.7 },
    { word: "strange", rarity: "Common", zipf: 4.6 },
    { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
  ];

  it("includes the puzzle number and drop, never the words themselves", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).toContain(`https://wordink.app #${puzzleNumber("2024-01-05")}`);
    expect(text).toContain("Drop: STR");
    for (const w of words) {
      expect(text).not.toContain(w.word);
    }
  });

  it("puts each spoiler-free rarity square and score on its own line", () => {
    const text = buildShareText("2024-01-05", "str", words);
    const resultLines = text.split("\n").slice(2, 2 + words.length);
    expect(resultLines).toEqual(["🥚", "🟨", "🟪"].map((symbol, i) => `${symbol} ${rarityScore(words[i].zipf).toFixed(1)}`));
  });

  it("separates the heading from the shared guesses", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).toContain("Drop: STR\n\n🥚 0.0");
  });

  it("omits the best-word summary", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).not.toContain("Best:");
  });

  it("is spoiler-free by default, with no explicit option passed", () => {
    const withDefault = buildShareText("2024-01-05", "str", words);
    const withExplicitTrue = buildShareText("2024-01-05", "str", words, { spoilerFree: true });
    expect(withDefault).toBe(withExplicitTrue);
  });

  it("shows the actual words and rarity scores, without rarity labels, when spoilerFree is false", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    for (const w of words) {
      expect(text).toContain(w.word);
    }
    expect(text).toContain(`aardvark (${rarityScore(2.4).toFixed(1)})`);
    expect(text).not.toContain("Extremely Rare");
  });

  it("puts each word and its rarity square on a separate line", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    const resultLines = text.split("\n").slice(2, 2 + words.length);
    // aardvark: Extremely Rare -> 🟪
    expect(resultLines).toContain(`🟪 aardvark (${rarityScore(2.4).toFixed(1)})`);
    expect(resultLines).toContain("🥚 the (0.0)");
    expect(resultLines).toHaveLength(words.length);
  });

  it("omits the best-word summary when spoilers are shown", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    expect(text).not.toContain("Best:");
  });

  it("includes the current streak when provided", () => {
    expect(buildShareText("2024-01-05", "str", words, { streak: 1 })).toContain("Streak: 1 day");
    expect(buildShareText("2024-01-05", "str", words, { streak: 4 })).toContain("Streak: 4 days");
  });

  it("puts the session total directly before the current puzzle's top rarity", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      streak: 4,
      crushedIt: 7,
      elite: 2,
    });

    const total = words.reduce((sum, word) => sum + rarityScore(word.zipf), 0);
    expect(text).toContain(`🟪 ${rarityScore(2.4).toFixed(1)}\n\nStreak: 4 days · Crushed it: 7 · Elite: 2\nTotal: ${total.toFixed(1)} · Top: ${rarityScore(2.4).toFixed(1)}`);
  });
});
