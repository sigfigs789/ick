import { describe, expect, it } from "vitest";
import { buildShareText, puzzleNumber } from "./share";
import dropData from "../data/drops.json";
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
    { word: "the", rarity: "Very Common", zipf: 7.7 },
    { word: "strange", rarity: "Common", zipf: 4.6 },
    { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
  ];

  it("includes the puzzle number and drop, never the words themselves", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).toContain(`WordInk #${puzzleNumber("2024-01-05")}`);
    expect(text).toContain("Ink: STR");
    for (const w of words) {
      expect(text).not.toContain(w.word);
    }
  });

  it("puts each spoiler-free rarity square and score on its own line", () => {
    const text = buildShareText("2024-01-05", "str", words);
    const resultLines = text.split("\n").slice(1, 1 + words.length);
    expect(resultLines).toEqual(["⬜ 2.3", "🟩 5.4", "🟧 7.6"]);
  });

  it("calls out the best (rarest) word's rarity, score, and the guess count", () => {
    const text = buildShareText("2024-01-05", "str", words);
    // aardvark: zipf 2.4 -> score (10 - 2.4) = 7.6 (higher score = rarer)
    expect(text).toContain("Best: Extremely Rare (7.6) · 3/6 guesses");
  });

  it("omits the best-word line when nothing has been accepted yet", () => {
    const text = buildShareText("2024-01-05", "str", []);
    expect(text).not.toContain("Best:");
  });

  it("is spoiler-free by default, with no explicit option passed", () => {
    const withDefault = buildShareText("2024-01-05", "str", words);
    const withExplicitTrue = buildShareText("2024-01-05", "str", words, { spoilerFree: true });
    expect(withDefault).toBe(withExplicitTrue);
  });

  it("shows the actual words, with rarity and score, when spoilerFree is false", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    for (const w of words) {
      expect(text).toContain(w.word);
    }
    // aardvark: zipf 2.4 -> score 7.6
    expect(text).toContain("aardvark (Extremely Rare, 7.6)");
  });

  it("puts each word and its rarity square on a separate line", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    const resultLines = text.split("\n").slice(1, 1 + words.length);
    // aardvark: Extremely Rare -> 🟧
    expect(resultLines).toContain("🟧 aardvark (Extremely Rare, 7.6)");
    // the: Very Common -> ⬜
    expect(resultLines).toContain("⬜ the (Very Common, 2.3)");
    expect(resultLines).toHaveLength(words.length);
  });

  it("still includes the best-word line when spoilers are shown", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    expect(text).toContain("Best: Extremely Rare (7.6) · 3/6 guesses");
  });

  it("includes the current streak when provided", () => {
    expect(buildShareText("2024-01-05", "str", words, { streak: 1 })).toContain("Streak: 1 day");
    expect(buildShareText("2024-01-05", "str", words, { streak: 4 })).toContain("Streak: 4 days");
  });

  it("puts streak trackers on one row and the high score below", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      streak: 4,
      crushedIt: 7,
      elite: 2,
      highScore: 8.5,
    });

    expect(text).toContain("Streak: 4 days · Crushed it: 7 · Elite: 2\nHigh score: 8.5");
  });
});
