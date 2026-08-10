import { describe, expect, it } from "vitest";
import { isValidWord, rarityFor, rarityScore } from "./dictionary";

describe("isValidWord", () => {
  it("accepts a common real word", () => {
    expect(isValidWord("the")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isValidWord("THE")).toBe(true);
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

  it("classifies a score of 8.5 as Mythic", () => {
    const mythic = rarityFor("abased");
    expect(mythic).toMatchObject({ rarity: "Mythic", zipf: 1.5 });
    expect(rarityScore(mythic!.zipf)).toBe(8.5);
  });
});

describe("rarityScore", () => {
  it("flips Zipf's polarity so a higher score means rarer", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;
    expect(rarityScore(rare.zipf)).toBeGreaterThan(rarityScore(common.zipf));
  });

  it("computes 10 minus zipf, rounded to one decimal", () => {
    expect(rarityScore(2.4)).toBeCloseTo(7.6);
    expect(rarityScore(7.7)).toBeCloseTo(2.3);
  });
});
