import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";

/**
 * The transitive fold (TRANSITIVE_FOLD_START, 2026-08-20): a base contributes its
 * *resolved* frequency to the word it caps, not its raw one, and a tense base no
 * corpus attests is declined outright.
 *
 * BEFORE is the previous era's last day, so every assertion pins both sides of the
 * cutover and a past puzzle can never be re-scored by this rule.
 */
const BEFORE = "2026-08-19";
const AFTER = "2026-08-20";

const WORDS = dictionaryWords as string[];

function score(word: string, date: string): number {
  return rarityScore(rarityFor(word, date)!.zipf, date);
}

describe("resolving a base all the way down", () => {
  it("stops a double plural outranking the singular it comes from", () => {
    // "prefigurativenesses" folds to "prefigurativeness", which is itself
    // unattested -- reading its raw Zipf left the plural at a perfect 10 while the
    // singular resolved through "prefigurative" to 9.74.
    expect(score("prefigurativenesses", BEFORE)).toBe(10);
    expect(score("prefigurativenesses", AFTER)).toBeCloseTo(9.74, 2);
    expect(score("prefigurativeness", AFTER)).toBeCloseTo(9.74, 2);
  });

  it("caps a -nesses stack at the everyday word underneath it", () => {
    // The case PR #141 called out as explicitly not covered by its own rule.
    expect(score("negativenesses", BEFORE)).toBeCloseTo(9.87, 2);
    expect(score("negativenesses", AFTER)).toBeCloseTo(4.32, 2);
    expect(rarityFor("negativenesses", AFTER)!.rarity).toBe("Common");
  });

  it("reports the resolved frequency the score was actually computed from", () => {
    const sub = baseFormSubstitution("prefigurativenesses", AFTER);
    expect(sub?.base).toBe("prefigurativeness");
    // The base's resolved Zipf (1.11 via "prefigurative"), not its raw sentinel.
    expect(sub?.baseZipf).toBeCloseTo(1.11, 2);
  });
});

describe("declining a tense base with no frequency", () => {
  it("keeps the word's own Zipf rather than inheriting a stand-in", () => {
    // "farebeating" is attested at Zipf -0.18; "farebeat" is not attested at all,
    // and the tense rule adopted it outright, discarding real data for the
    // stand-in. Both land on a perfect 10 today, so this is pinned on the Zipf.
    expect(rarityFor("farebeating", BEFORE)!.zipf).toBeCloseTo(-1.57, 2);
    expect(rarityFor("farebeating", AFTER)!.zipf).toBeCloseTo(-0.18, 2);
    expect(baseFormSubstitution("farebeating", AFTER)).toBeUndefined();
  });

  it("still inherits a tense base that has a frequency", () => {
    // The rule this must not break: a tense form takes its base exactly, even
    // when that lowers the score.
    expect(rarityFor("making", AFTER)!.zipf).toBe(rarityFor("make", AFTER)!.zipf);
    expect(rarityFor("played", AFTER)!.zipf).toBe(rarityFor("play", AFTER)!.zipf);
  });
});

describe("the fold stays a one-way cap", () => {
  it("makes no word rarer than the era before", () => {
    // Resolution must never pass a demotion down a chain: "ongoing" is itself
    // scored as the rare "ongo", and handing that to "ongoings" would invent
    // rarity rather than remove it (see resolvedZipf).
    const rarer: string[] = [];
    for (const word of WORDS) {
      if (score(word, AFTER) > score(word, BEFORE)) rarer.push(word);
    }
    // "celestes" is the one exception, and it is inherited rather than introduced:
    // the previous era's -est rule caps "celest" (Zipf 1.14) at "cel" (2.79) --
    // "celest" is not a superlative of "cel" -- and resolution now passes that
    // 2.79 up to "celestes", which previously read "celeste" (3.19) directly.
    // Fixing it belongs to the -est rule, not here.
    expect(rarer).toEqual(["celestes"]);
  });

  it("leaves earlier eras frozen", () => {
    for (const [word, expected] of [
      ["prefigurativenesses", 10],
      ["negativenesses", 9.87],
      ["patientest", 4.35],
    ] as const) {
      expect(score(word, BEFORE)).toBeCloseTo(expected, 2);
    }
    // The 2026-08-16 era predates both folds, so "patientest" keeps its old 9.92.
    expect(score("patientest", "2026-08-18")).toBeCloseTo(9.92, 2);
  });

  it("never lets a -nesses plural outscore its own -ness singular", () => {
    const offenders: string[] = [];
    for (const word of WORDS) {
      if (!word.endsWith("nesses")) continue;
      const singular = word.slice(0, -2);
      if (!WORDS.includes(singular)) continue;
      if (score(word, AFTER) > score(singular, AFTER) + 0.001) offenders.push(word);
    }
    expect(offenders).toEqual([]);
  });
});
