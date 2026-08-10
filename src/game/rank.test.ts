import { describe, expect, it } from "vitest";
import { bestWord, isEliteRarity, isWinningRarity } from "./rank";
import type { AcceptedWord } from "./types";

describe("bestWord", () => {
  it("returns undefined for an empty list", () => {
    expect(bestWord([])).toBeUndefined();
  });

  it("returns the only word in a single-item list", () => {
    const words: AcceptedWord[] = [{ word: "the", rarity: "Very Common", zipf: 7.7 }];
    expect(bestWord(words)).toEqual(words[0]);
  });

  it("picks the word with the lowest zipf (rarest)", () => {
    const words: AcceptedWord[] = [
      { word: "the", rarity: "Very Common", zipf: 7.7 },
      { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
      { word: "strange", rarity: "Common", zipf: 4.6 },
    ];
    expect(bestWord(words)?.word).toBe("aardvark");
  });

  it("breaks ties by keeping the first word encountered", () => {
    const words: AcceptedWord[] = [
      { word: "first", rarity: "Rare", zipf: 3.0 },
      { word: "second", rarity: "Rare", zipf: 3.0 },
    ];
    expect(bestWord(words)?.word).toBe("first");
  });
});

describe("rarity thresholds", () => {
  it("treats Elusive as a winning Elite tier", () => {
    expect(isWinningRarity("Elusive")).toBe(true);
    expect(isEliteRarity("Elusive")).toBe(true);
  });
});
