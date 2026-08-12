import { describe, expect, it } from "vitest";
import { isValidWord, rarityFor, rarityScore } from "./dictionary";

describe("isValidWord", () => {
  it("accepts a common real word", () => {
    expect(isValidWord("the")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isValidWord("THE")).toBe(true);
  });

  it("accepts SCOWL words that have no wordfreq estimate", () => {
    expect(isValidWord("curtaining")).toBe(true);
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
    expect(info?.rarity).toBe("Very Common");
    expect(info?.zipf).toBeGreaterThan(7);
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

  it("scores an unmeasured word at 9.4 without awarding Mythic", () => {
    const unknown = rarityFor("assonant");
    expect(unknown).toMatchObject({ rarity: "Extremely Rare", zipf: 0.5 });
    expect(rarityScore(unknown!.zipf)).toBe(9.4);
  });
});

describe("rarityScore", () => {
  it("flips Zipf's polarity so a higher score means rarer", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;
    expect(rarityScore(rare.zipf)).toBeGreaterThan(rarityScore(common.zipf));
  });

  it("normalizes against Zipf's 0.0 floor and the dictionary's upper bound", () => {
    // "the" is the dictionary's most common word (highest Zipf) -- it anchors the floor.
    const mostCommon = rarityFor("the")!;
    // Unmeasured SCOWL words use the 0.5 fallback and remain below the 10.0 ceiling.
    const rarest = rarityFor("assonant")!;
    expect(rarityScore(mostCommon.zipf)).toBe(0);
    expect(rarityScore(rarest.zipf)).toBeLessThan(10);
    expect(rarityScore(0)).toBe(10);
    expect(rarityScore(2.4)).toBeGreaterThan(rarityScore(3.3));
  });
});
