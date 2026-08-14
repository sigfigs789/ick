import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { isValidWord, rarityFor, rarityScore, topRarityScore } from "./dictionary";

const explicitlyCuratedWords = ["endling", "fenestron"];
const wiktionaryScienceWords = ["biohacking", "neuropsychopharmacology", "scientometrics"];

describe("isValidWord", () => {
  it("keeps the curated dictionary size intentional", () => {
    // Update this only when deliberately regenerating or editing the word list.
    expect(dictionaryWords).toHaveLength(224_862);
  });

  it("accepts a common real word", () => {
    expect(isValidWord("the")).toBe(true);
  });

  it("accepts one- and two-letter dictionary words", () => {
    expect(isValidWord("a")).toBe(true);
    expect(isValidWord("at")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isValidWord("THE")).toBe(true);
  });

  it("accepts SCOWL words that have no wordfreq estimate", () => {
    expect(isValidWord("curtaining")).toBe(true);
  });

  it("accepts long SCOWL words", () => {
    expect(isValidWord("gastroenterology")).toBe(true);
  });

  it("accepts explicitly curated additions", () => {
    for (const word of explicitlyCuratedWords) {
      expect(isValidWord(word), `${word} should be a valid dictionary input`).toBe(true);
    }
  });

  it("accepts scored Wiktionary science terms", () => {
    for (const word of wiktionaryScienceWords) {
      expect(isValidWord(word)).toBe(true);
      expect(rarityFor(word)?.zipf).not.toBe(1.4);
    }
  });

  it("accepts spelling variants from supported English regions", () => {
    expect(isValidWord("color")).toBe(true);
    expect(isValidWord("colour")).toBe(true);
    expect(isValidWord("organize")).toBe(true);
    expect(isValidWord("organise")).toBe(true);
    expect(isValidWord("paycheque")).toBe(true);
    expect(isValidWord("bikkie")).toBe(true);
  });

  it("rejects gibberish", () => {
    expect(isValidWord("zzzzqx")).toBe(false);
  });

  it("rejects blocklisted slurs even though they'd otherwise be common enough", () => {
    expect(isValidWord("nigger")).toBe(false);
  });

  it("rejects blocklisted abbreviations", () => {
    expect(isValidWord("aka")).toBe(false);
  });
});

describe("rarityFor", () => {
  it("returns a rarity and zipf score for a known word", () => {
    const info = rarityFor("the");
    expect(info?.rarity).toBe("Quotidian");
    expect(info?.zipf).toBeGreaterThan(7);
  });

  it("reserves Quotidian for scores below 2.0", () => {
    expect(rarityFor("about")?.rarity).toBe("Quotidian");
    expect(rarityScore(rarityFor("about")!.zipf)).toBeLessThan(2);
    expect(rarityFor("there")?.rarity).toBe("Very Common");
  });

  it("returns undefined for a word not in the dictionary", () => {
    expect(rarityFor("zzzzqx")).toBeUndefined();
  });

  it("rarer words have a lower zipf score than common ones", () => {
    const common = rarityFor("the");
    const rare = rarityFor("aardvark");
    expect(common).toBeDefined();
    expect(rare).toBeDefined();
    expect(rare!.zipf).toBeLessThan(common!.zipf);
  });

  it("caps transparent derived words at their more common base word's score", () => {
    const alert = rarityFor("alert")!;

    expect(rarityFor("alertly")).toEqual(alert);
    expect(rarityFor("alertness")).toEqual(alert);
    expect(rarityFor("curtaining")).toEqual(rarityFor("curtain"));
  });

  it("uses the base word's exact frequency for past and ongoing verb forms", () => {
    expect(rarityFor("played")).toEqual(rarityFor("play"));
    expect(rarityFor("rated")).toEqual(rarityFor("rate"));
    expect(rarityFor("planned")).toEqual(rarityFor("plan"));
    expect(rarityFor("studied")).toEqual(rarityFor("study"));
    expect(rarityFor("making")).toEqual(rarityFor("make"));
    expect(rarityFor("running")).toEqual(rarityFor("run"));
    expect(rarityFor("dying")).toEqual(rarityFor("die"));
  });

  it("scores an unmeasured word at 9.4 without awarding Mythic", () => {
    const unknown = rarityFor("assonant");
    expect(unknown).toMatchObject({ rarity: "Extremely Rare", zipf: 1.4 });
    expect(rarityScore(unknown!.zipf)).toBe(9.4);
  });

  it("awards Mythic only for a rank of 9.5 or higher", () => {
    const belowMythic = rarityFor("assonant")!;
    const mythic = rarityFor("abatis")!;

    expect(rarityScore(belowMythic.zipf)).toBeLessThan(9.5);
    expect(belowMythic.rarity).not.toBe("Mythic");
    expect(rarityScore(mythic.zipf)).toBeGreaterThanOrEqual(9.5);
    expect(mythic.rarity).toBe("Mythic");
  });
});

describe("rarityScore", () => {
  it("flips Zipf's polarity so a higher score means rarer", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;
    expect(rarityScore(rare.zipf)).toBeGreaterThan(rarityScore(common.zipf));
  });

  it("normalizes against the dictionary's Zipf range", () => {
    // "the" is the dictionary's most common word (highest Zipf) -- it anchors the floor.
    const mostCommon = rarityFor("the")!;
    // A measured Zipf 1.0 anchors the 10.0 ceiling; unmeasured words use 1.4.
    const unknown = rarityFor("assonant")!;
    expect(rarityScore(mostCommon.zipf)).toBe(0);
    expect(rarityScore(1)).toBe(10);
    expect(rarityScore(unknown.zipf)).toBe(9.4);
    expect(rarityScore(2.4)).toBeGreaterThan(rarityScore(3.3));
  });
});

describe("topRarityScore", () => {
  it("returns the highest score from the current puzzle's accepted words", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;

    expect(topRarityScore([common, rare])).toBe(rarityScore(rare.zipf));
    expect(topRarityScore([])).toBe(0);
  });
});
