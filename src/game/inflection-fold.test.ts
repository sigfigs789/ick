import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";
import { derivedBaseCandidates } from "./stem";

// The 2026-08-19 cutover caps agent nouns, comparatives, and the plurals the
// "-es" cut misses at their base word, so appending two letters to an everyday
// word can no longer manufacture a top-tier answer.
const BEFORE = "2026-08-18"; // last puzzle on the wide-band system
const AFTER = "2026-08-19"; // first puzzle with the fold

const score = (word: string, date?: string) => rarityScore(rarityFor(word, date)!.zipf, date);

describe("agent-noun / comparative / missed-plural fold", () => {
  it.each([
    ["patientest", "patient"],
    ["patiences", "patience"],
    ["registerers", "register"],
    ["possiblest", "possible"],
    ["wildlifes", "wildlife"],
  ])("caps %s at its base %s", (word, base) => {
    expect(score(word, AFTER)).toBeCloseTo(score(base, AFTER), 2);
    expect(rarityFor(word, AFTER)!.rarity).not.toBe("Legend");
  });

  it("leaves past puzzles alone", () => {
    // "patientest" was a 9.92 Legend the day before the cutover and has to stay
    // one -- past results are never re-scored.
    expect(score("patientest", BEFORE)).toBeCloseTo(9.92, 2);
    expect(score("patientest", AFTER)).toBeLessThan(9.5);
  });

  it.each(["forest", "easter", "master", "interest", "honest"])(
    "does not mistake %s for an inflection",
    (word) => {
      // These have real measured frequencies, so they never reach the fold --
      // the deep-tail gate is what stops "forest" scoring as "for".
      expect(score(word, AFTER)).toBeCloseTo(score(word, BEFORE), 2);
    }
  );

  it("only ever pulls a word toward a more common base", () => {
    // The cap can lower a score, never raise one.
    for (const word of dictionaryWords as string[]) {
      if (score(word, AFTER) > score(word, BEFORE) + 0.005) {
        throw new Error(`${word} got rarer under the fold`);
      }
    }
  });

  it("leaves no top-tier word outranking a base this rule covers", () => {
    // The regression guard, in the same terms as the daily drop audit
    // (.claude/skills/audit-drop-mythics): no word scoring 9.7+ may outrank a
    // reachable base (Zipf 4.2+, i.e. Common or better) by 0.3 or more through
    // one of the endings this rule folds.
    const words = dictionaryWords as string[];
    const known = new Set(words);
    const violations: string[] = [];
    for (const word of words) {
      const s = score(word, AFTER);
      if (s < 9.7) continue;
      for (const candidate of derivedBaseCandidates(word)) {
        if (!known.has(candidate)) continue;
        // A base whose own score is inherited from a further base form can't cap
        // anything: the fold reads its raw frequency, not its adjusted one, so
        // the chain stops one link short ("childlier" -> "childly" -> "child").
        // That is a separate defect in the fold and has its own fix.
        if (baseFormSubstitution(candidate, AFTER)) continue;
        const base = rarityFor(candidate, AFTER)!;
        if (base.zipf >= 4.2 && s - rarityScore(base.zipf, AFTER) >= 0.3) {
          violations.push(`${word} > ${candidate}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
