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
    expect(text).toContain(`Ink #${puzzleNumber("2024-01-05")}`);
    expect(text).toContain('"str"');
    for (const w of words) {
      expect(text).not.toContain(w.word);
    }
  });

  it("includes one rarity square per accepted word", () => {
    const text = buildShareText("2024-01-05", "str", words);
    const squareLine = text.split("\n")[1];
    expect(squareLine.split(" ")).toHaveLength(words.length);
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

  it("still includes the best-word line when spoilers are shown", () => {
    const text = buildShareText("2024-01-05", "str", words, { spoilerFree: false });
    expect(text).toContain("Best: Extremely Rare (7.6) · 3/6 guesses");
  });
});
