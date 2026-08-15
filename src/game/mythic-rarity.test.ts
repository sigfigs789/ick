import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { rarityFor, rarityScore } from "./dictionary";

// The Mythic tier is the top rank, gated on a rarity score of 9.5 or higher.
// The 9.5 cutoff only exists under the pre-2026-08-15 ("legacy") scoring, so
// every case here pins an explicit legacy puzzle date -- the current/wide
// system tops the measured band out at 9.9 instead (see dictionary.ts).
const LEGACY_DATE = "2026-08-14";

// Concrete boundary words drawn from the shipped frequency data. Scores round
// to one decimal, so the data straddles the cutoff (9.4 | 9.6) rather than
// landing on 9.5 exactly -- the whole-dictionary scan below proves the boundary
// itself sits at 9.5.
const JUST_ABOVE = "abatis"; //   Zipf 1.3 -> score 9.6  -> Mythic
const PERFECT = "abash"; //       Zipf 1.0 -> score 10.0 -> Mythic
const JUST_BELOW = "abacavir"; // Zipf 1.4 -> score 9.4  -> Extremely Rare

describe("Mythic tier boundary at rarity score 9.5 (legacy scoring)", () => {
  it("labels a word scoring above 9.5 as Mythic", () => {
    const info = rarityFor(JUST_ABOVE, LEGACY_DATE)!;
    expect(rarityScore(info.zipf, LEGACY_DATE)).toBe(9.6);
    expect(info.rarity).toBe("Mythic");
  });

  it("labels a word scoring a perfect 10 as Mythic", () => {
    const info = rarityFor(PERFECT, LEGACY_DATE)!;
    expect(rarityScore(info.zipf, LEGACY_DATE)).toBe(10);
    expect(info.rarity).toBe("Mythic");
  });

  it("labels a word scoring just below 9.5 as Extremely Rare, not Mythic", () => {
    const info = rarityFor(JUST_BELOW, LEGACY_DATE)!;
    expect(rarityScore(info.zipf, LEGACY_DATE)).toBe(9.4);
    expect(info.rarity).toBe("Extremely Rare");
    expect(info.rarity).not.toBe("Mythic");
  });

  it("puts the boundary exactly at 9.5 across the whole dictionary", () => {
    // Mythic iff score >= 9.5, for every dictionary word -- no word scoring 9.5+
    // slips below Mythic, and no Mythic word scores under 9.5. This is what pins
    // the cutoff to 9.5 (inclusive on the Mythic side), independent of the
    // hand-picked examples above.
    const words = dictionaryWords as string[];
    const violations: string[] = [];
    for (const word of words) {
      const info = rarityFor(word, LEGACY_DATE)!;
      const score = rarityScore(info.zipf, LEGACY_DATE);
      const isMythic = info.rarity === "Mythic";
      if ((score >= 9.5) !== isMythic) {
        violations.push(`${word} (score ${score}, ${info.rarity})`);
      }
    }
    expect(violations).toEqual([]);
  });
});
