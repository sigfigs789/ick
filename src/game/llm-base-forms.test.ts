import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import llmBaseFormData from "../data/llm-base-forms.json";
import rarityData from "../data/rarity.json";
import { baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";

const WORDS = dictionaryWords as string[];
const INDEX = new Map(WORDS.map((w, i) => [w, i]));
const pairs = llmBaseFormData.words.map((word, i) => ({
  word: WORDS[word],
  base: WORDS[llmBaseFormData.bases[i]],
}));

// The day the LLM-adjudicated base forms switch on (LLM_BASE_START), and the day
// before it, which must still score the old way.
const AFTER = "2026-08-19";
const BEFORE = "2026-08-18";

/** A word's own Zipf straight out of rarity.json, before any base-form adjustment. */
function rawZipf(word: string): number {
  return rarityData.zipfHundredths[INDEX.get(word)!] / 100;
}

describe("LLM-adjudicated base forms", () => {
  it("caps a confirmed derived form at its base word's frequency", () => {
    // The motivating case: "lactational" is barely attested (Zipf 1.13, a 9.71
    // Mythic on its own data) purely because corpora rarely contain it, while
    // anyone who knows "lactation" can bolt "-al" on.
    expect(rarityFor("lactational", AFTER)!.zipf).toBe(rarityFor("lactation", AFTER)!.zipf);
    expect(rarityFor("lactational", AFTER)!.rarity).toBe("Rare");
  });

  it("leaves earlier puzzles on the score they were played with", () => {
    const own = rarityFor("lactational", BEFORE)!;
    expect(own.rarity).toBe("Mythic");
    expect(own.zipf).toBeLessThan(rarityFor("lactation", BEFORE)!.zipf);
  });

  it("leaves a word with no adjudicated base alone", () => {
    // Genuinely rare, not a derived form of anything -- still a Legend.
    expect(rarityFor("endling", AFTER)!.rarity).toBe("Legend");
    expect(rarityFor("endling", AFTER)!.zipf).toBe(rarityFor("endling", BEFORE)!.zipf);
  });

  it("leaves a word alone when the base's common sense is the wrong one", () => {
    // "husbander" is built on the verb "husband" (to conserve), but that word's
    // frequency is almost entirely the spouse noun -- capping here would score a
    // rare word as an everyday one. Same for "outwill", where "will" is measured
    // as the modal auxiliary, not the noun meaning resolve.
    for (const word of ["husbander", "outwill", "misstate", "outstate"]) {
      expect(rarityFor(word, AFTER)!.zipf).toBe(rarityFor(word, BEFORE)!.zipf);
    }
  });

  it("leaves a rejected pair alone", () => {
    // "withier" is the comparative of "withy" (a willow twig), not "with", so
    // llm-base-forms.txt records it as a `no` and the score stands.
    expect(rarityFor("withier", AFTER)!.zipf).toBe(rarityFor("withier", BEFORE)!.zipf);
    expect(rarityScore(rarityFor("withier", AFTER)!.zipf, AFTER)).toBe(10);
  });

  it("reports the adjudicated base as the substitution behind the score", () => {
    const sub = baseFormSubstitution("lactational", AFTER);
    expect(sub?.base).toBe("lactation");
    expect(sub?.baseZipf).toBeGreaterThan(sub!.ownZipf);
    expect(baseFormSubstitution("lactational", BEFORE)).toBeUndefined();
  });

  it("keeps the existing spelling-rule adjustments working alongside it", () => {
    expect(baseFormSubstitution("trivialization", AFTER)?.base).toBe("trivialize");
    expect(baseFormSubstitution("played", AFTER)?.base).toBe("play");
  });
});

describe("llm-base-forms.json", () => {
  it("is a well-formed pair of index arrays", () => {
    expect(llmBaseFormData.words).toHaveLength(llmBaseFormData.bases.length);
    for (const { word, base } of pairs) {
      expect(word).toBeTypeOf("string");
      expect(base).toBeTypeOf("string");
    }
  });

  it("never maps a word to itself", () => {
    expect(pairs.filter(({ word, base }) => word === base)).toEqual([]);
  });

  it("only ever makes a word more common, never rarer", () => {
    // The adjustment is a cap, so no entry may push a word's score *up*. A wrong
    // entry can cost a word its inflated score; it can never invent a rarer one.
    const demotions = pairs.filter(
      ({ word }) => rarityFor(word, AFTER)!.zipf < rarityFor(word, BEFORE)!.zipf
    );
    expect(demotions).toEqual([]);
  });

  it("pairs every word with a base that is genuinely more common", () => {
    // Measured against each word's own frequency, before any adjustment -- an
    // entry whose base is no commoner would be a no-op the compile step drops.
    const notCommoner = pairs.filter(({ word, base }) => rawZipf(base) <= rawZipf(word));
    expect(notCommoner).toEqual([]);
  });

  it("only references words that are in the dictionary", () => {
    const missing = pairs.filter(({ word, base }) => !INDEX.has(word) || !INDEX.has(base));
    expect(missing).toEqual([]);
  });
});
