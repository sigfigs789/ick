import { describe, expect, it } from "vitest";
import { baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";
import { evaluateSubmission } from "./submit";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import type { AcceptedWord } from "./types";

// The 2026-08-21 cutover: a plural or third-person form no longer out-scores the
// word it came from. Expected values are hardcoded rather than recomputed through
// the functions under test, matching scoring.test.ts, so a regression in the fold
// rules or the frequency data is actually caught.
const BEFORE = "2026-08-20"; // last day on the chained-base-only system
const ON = "2026-08-21"; // first day the number inflections fold

const score = (word: string, date: string) => rarityScore(rarityFor(word, date)!.zipf, date);
const rank = (word: string, date?: string) => rarityFor(word, date)!.rarity;

describe("number inflections fold onto their base (from 2026-08-21)", () => {
  // word, base, score before the cutover, score on/after, and the rule at work.
  const FOLDS: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // "-es" where the base keeps its "e" -- the gap that motivated the change.
    // baseForm strips both letters and lands on the non-word "asphyxiat", so
    // nothing capped the word and a bare "-s" out-scored its own verb by a rank.
    ["asphyxiates", "asphyxiate", 9.77, 8.75],
    ["houses", "house", 4.43, 2.97],
    ["saves", "save", 5.38, 3.81],
    ["caves", "cave", 5.94, 5.19],
    // SCOWL artifacts that were scoring like genuine finds.
    ["despites", "despite", 9.9, 4.02],
    // "-ies" at five letters, where baseForm's rule needs six.
    ["cries", "cry", 5.59, 4.62],
    ["tries", "try", 4.71, 3.28],
    // "-ies" whose base ends in "i".
    ["alkalies", "alkali", 9.05, 7.05],
    // Irregular plurals spelled with a stem change.
    ["wolves", "wolf", 5.47, 4.97],
    ["meatloaves", "meatloaf", 9.94, 7.19],
    ["matrices", "matrix", 6.69, 5.38],
    ["apices", "apex", 8.68, 5.91],
    // The classical plurals borrowed whole, and the native "-men" plural.
    ["scapulae", "scapula", 8.91, 7.75],
    ["radii", "radius", 7.62, 5.69],
    ["abaci", "abacus", 9.62, 7.47],
    ["chairmen", "chairman", 6.75, 4.31],
    // "-ied" no longer shadows the plain "-ed" bases, so a past tense whose base
    // ends in "i" finally has somewhere to land.
    ["taxied", "taxi", 8.47, 5.21],
  ];

  it.each(FOLDS)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON)).toBe(after);
    expect(score(word, ON)).toBe(score(base, ON));
  });

  it.each(FOLDS)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE)).toBe(before);
  });

  it.each(FOLDS)("%s reports the substitution for analytics", (word, base) => {
    expect(baseFormSubstitution(word, ON)?.base).toBe(base);
  });

  it.each(FOLDS)("%s leaves its base untouched", (_word, base, _before, after) => {
    // The fold is a cap on the derived form only. A base that folds nowhere must
    // score identically on both sides of the cutover.
    expect(score(base, BEFORE)).toBe(after);
    expect(score(base, ON)).toBe(after);
  });

  it("defaults to the newest system when no date is given", () => {
    expect(rarityFor("asphyxiates")!.zipf).toBe(rarityFor("asphyxiate")!.zipf);
    expect(rank("asphyxiates")).toBe("Extremely Rare");
  });

  it("picks the most common base rather than the first spelling rule to match", () => {
    // "caves" looks like a "-ves" plural of "cafe" as much as an "-es" plural of
    // "cave"; "saves" looks like one of "safe". The more common word wins, which
    // is the right base in both.
    expect(baseFormSubstitution("caves", ON)?.base).toBe("cave");
    expect(baseFormSubstitution("saves", ON)?.base).toBe("save");
  });
});

// The suffixes whose spelling is not decisive fold only below MEASURED_FLOOR
// (Zipf 1.0), where a word's score is a stand-in rather than a measurement.
describe("comparatives and Latin plurals fold, but only below the measurement floor", () => {
  const GATED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // "-est"/"-er": a suffix was worth a perfect 10.00 on words nobody would
    // call a discovery.
    ["specialest", "special", 10, 3.52],
    ["beautifuler", "beautiful", 9.95, 3.69],
    ["babiest", "baby", 10, 3.63],
    ["thanker", "thank", 9.95, 3.31],
    ["abandoner", "abandon", 9.91, 5.46],
    // The chain keeps walking past the immediate parent to the most common word
    // it can reach, which is the whole point of capping: "knowinger" folds
    // through "knowing" onto "know".
    ["knowinger", "know", 10, 2.4],
    // The Latin neuter plural.
    ["asyla", "asylum", 9.92, 5.5],
    ["pepla", "peplum", 9.95, 8.12],
    ["clitella", "clitellum", 9.98, 8.33],
    // "-ize"/"-ise" verbs fold to the stem they were built from.
    ["containerise", "container", 9.96, 5.44],
    ["ghettoise", "ghetto", 9.96, 5.94],
    ["tautologize", "tautology", 10, 8.08],
    // ... which also un-sticks the "-ization" fold, which used to dead-end on the
    // unattested verb ("winterisation" -> "winterise", Zipf -0.45, and stop).
    ["winterisation", "winter", 9.96, 4.18],
    // "-able"/"-ible" likewise.
    ["interviewable", "interview", 9.96, 4.22],
    ["requirable", "require", 9.92, 4.34],
  ];

  it.each(GATED)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON)).toBe(after);
    expect(baseFormSubstitution(word, ON)?.base).toBe(base);
  });

  it.each(GATED)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE)).toBe(before);
  });

  it.each(GATED)("%s was Mythic or better before, and is not after", (word) => {
    expect(["Mythic", "Legend"]).toContain(rank(word, BEFORE));
    expect(["Mythic", "Legend"]).not.toContain(rank(word, ON));
  });

  it("leaves a word the corpora actually measure alone, however it ends", () => {
    // Every one of these is a word a spelling rule would happily mangle --
    // "tempest" -> "temp", "canter" -> "cant", "noter" -> "not", "shoulder" ->
    // "should", "comma" -> "common", "alba" -> "album". The gate excludes them
    // all, because each carries a real frequency (Zipf 1.07 to 4.73) and a guess
    // from an ending must not overrule a measurement.
    for (const word of [
      "tempest",
      "canter",
      "noter",
      "theer",
      "shoulder",
      "privateer",
      "commoner",
      "honest",
      "forest",
      "modest",
      "harvest",
      "comma",
      "alba",
      "dura",
      // The "-ize"/"-able" families make the same point louder: ungated they
      // fold "capsize" -> "cap", "downsize" -> "downs", "expertise" ->
      // "expert", "likeable" -> "like", "countable" -> "county" (!) and
      // "fallible" -> "fall".
      "capsize",
      "downsize",
      "expertise",
      "treatise",
      "improvise",
      "likeable",
      "workable",
      "countable",
      "fallible",
      "sensible",
      "probable",
    ]) {
      expect(baseFormSubstitution(word, ON), `${word} must not fold`).toBeUndefined();
      expect(score(word, BEFORE), `${word} must not move`).toBe(score(word, ON));
    }
  });
});

describe("what the cutover deliberately leaves alone", () => {
  it("keeps five-letter -ing words scoring on their own frequency", () => {
    // The gate settles this family on its own: every five-letter "-ing" word is
    // measured above the floor, so none of them fold. That is what keeps "thing"
    // from scoring as "the" (a flat 0.00) and "doing" from scoring as "do" --
    // and the price is that "iring" and "hoing" keep an unearned Mythic.
    expect(score("thing", ON)).toBe(2.96);
    expect(score("doing", ON)).toBe(3.13);
    expect(baseFormSubstitution("thing", ON)).toBeUndefined();
    expect(baseFormSubstitution("doing", ON)).toBeUndefined();
    expect(baseFormSubstitution("iring", ON)).toBeUndefined();
  });

  it("keeps the -en verbs scoring on their own frequency", () => {
    // "-en" folds are right often enough to tempt ("harshen" -> "harsh",
    // "plumpen" -> "plump") and wrong often enough to disqualify: measured, the
    // same rule folds "dudeen" (a clay pipe) onto "dude", "shoneen" onto "shone"
    // and "torten" onto "tort". 51 words, ~6 of them wrong, so the family stays
    // with the reviewed overrides.
    for (const word of ["harshen", "dudeen", "plumpen", "hoarsen"]) {
      expect(baseFormSubstitution(word, ON), `${word} must not fold`).toBeUndefined();
      expect(score(word, BEFORE)).toBe(score(word, ON));
    }
  });

  it("routes a coincidental homograph through a reviewed override", () => {
    // "theses" is the plural of "thesis", but the only base the spelling rules
    // can reach is "these" -- far more common, and not the word's base at all.
    // src/data/score-overrides.json pins it, and the override beats every rule.
    expect(baseFormSubstitution("theses", ON)?.base).toBe("thesis");
    expect(score("theses", ON)).toBe(score("thesis", ON));
    expect(score("theses", ON)).not.toBe(score("these", ON));
  });
});

describe("invariants across the whole dictionary", () => {
  const words = dictionaryWords as string[];

  // A fold may only ever demote. Stated on the Zipf rather than the score so it
  // is independent of the band tuning: a word's own measured Zipf is the
  // evidence, and no spelling rule may claim a word is rarer than that.
  //
  // This is the contract `adjustedZipf`'s `Math.max` implements, and it is worth
  // asserting separately from the cutover cases above because the *older* shape
  // is still in the file: the pre-2026-08-19 branch of `adjustedZipf` returns a
  // tense base's frequency outright (`return zipfFor(tenseBase, scoring)`)
  // instead of capping against it. That one line promoted 7,114 words -- it is
  // why "beloved" (measured 4.17) scored 9.75 Mythic as "belove" (1.10). A new
  // rule copied from that branch would reintroduce it silently, and no
  // date-pinned test would notice.
  const CHAINED_ERA = ["2026-08-19", "2026-08-20", "2026-08-21", "2027-06-01", undefined];

  it.each(CHAINED_ERA)("no fold makes a word rarer than its own measurement (%s)", (date) => {
    const promoted: string[] = [];
    for (const [i, word] of words.entries()) {
      const own = rarityData.zipfHundredths[i] / 100;
      const used = rarityFor(word, date)!.zipf;
      if (used < own - 1e-9) promoted.push(`${word} ${own} -> ${used}`);
    }
    expect(promoted).toEqual([]);
  });

  it("did not hold before 2026-08-19, and the boundary is deliberate", () => {
    // Pinned so the boundary cannot move by accident. Archived puzzles keep the
    // scores they were played with, promotions included -- that is the whole
    // point of the date gate, not an oversight to be tidied up later.
    expect(rarityFor("beloved", "2026-08-18")!.zipf).toBe(1.1); // "belove", inherited
    expect(rarityScore(rarityFor("beloved", "2026-08-18")!.zipf, "2026-08-18")).toBe(9.75);
    expect(rarityFor("beloved", "2026-08-18")!.rarity).toBe("Mythic");
    // From the chained system on, it scores on its own measurement.
    expect(rarityFor("beloved", "2026-08-19")!.zipf).toBe(4.17);
    expect(rarityFor("beloved", ON)!.zipf).toBe(4.17);
  });

  it("never reports a promotion as a base-form substitution", () => {
    // Analytics reads this. A substitution is only reported where the chain beat
    // the word's own frequency, so it can never describe a fold that raised a
    // score even if one somehow existed.
    for (const [i, word] of words.entries()) {
      const substitution = baseFormSubstitution(word, ON);
      if (!substitution) continue;
      expect(substitution.baseZipf).toBeGreaterThan(rarityData.zipfHundredths[i] / 100 - 1e-9);
    }
  });

  it("never raises a word's score", () => {
    // Every fold is a cap, and the latest system's candidate set is a superset of
    // the older one's, so the maximum it takes can only rise -- which can only
    // push a score down. A word scoring *higher* than it did means a fold pruned
    // a branch the older system reached, which is the bug this asserts against.
    const raised: string[] = [];
    for (const word of words) {
      const before = rarityScore(rarityFor(word, BEFORE)!.zipf, BEFORE);
      const after = rarityScore(rarityFor(word, ON)!.zipf, ON);
      if (after > before + 1e-9) raised.push(`${word} ${before} -> ${after}`);
    }
    expect(raised).toEqual([]);
  });

  it("moves thousands of words down, so the cases above are not a rounding story", () => {
    let lowered = 0;
    for (const word of words) {
      const before = rarityScore(rarityFor(word, BEFORE)!.zipf, BEFORE);
      if (rarityScore(rarityFor(word, ON)!.zipf, ON) < before - 1e-9) lowered++;
    }
    expect(lowered).toBeGreaterThan(10000);
  });

  it("never lets a folded word score rarer than the base it folded onto", () => {
    // The player-facing promise: a plural or third-person form can tie its base
    // but never beat it.
    for (const word of words) {
      const substitution = baseFormSubstitution(word, ON);
      if (!substitution) continue;
      expect(
        score(word, ON),
        `${word} must not out-score ${substitution.base}`
      ).toBeLessThanOrEqual(score(substitution.base, ON));
    }
  });
});

describe("the cutover changes scoring only", () => {
  it("leaves duplicate detection exactly as it was", () => {
    // scoringBaseForm widened; submit.ts's rootKey (and the `baseForm` stemmer it
    // uses) did not. Scoring a word as its base was never a claim that a puzzle
    // may only have one of them, so the same-root verdict is unchanged on both
    // sides of the cutover -- including where it still lets a pair through.
    //
    // "glasses" collapses onto "glass" because baseForm's two-letter "-es" strip
    // happens to land on a word. "asphyxiates" does not collapse onto
    // "asphyxiate", because that same strip lands on "asphyxiat" -- the very gap
    // this cutover closes for *scoring*. Widening the shared stemmer would change
    // which words a player may submit, not just what they are worth, so it is a
    // separate decision and deliberately not made here.
    const cases: ReadonlyArray<[first: string, second: string, drop: string, sameRoot: boolean]> = [
      ["glass", "glasses", "AS", true],
      ["asphyxiate", "asphyxiates", "PHY", false],
    ];
    for (const [first, second, drop, sameRoot] of cases) {
      const accepted: AcceptedWord[] = [{ word: first, ...rarityFor(first, ON)! }];
      for (const date of [BEFORE, ON]) {
        const result = evaluateSubmission(second, drop, accepted, date);
        expect(result.ok, `${second} after ${first} on ${date}`).toBe(!sameRoot);
        if (!result.ok) expect(result.reason).toBe("same-root-as-used");
      }
    }
  });

  it("leaves validity alone", () => {
    // A demoted word is still perfectly playable; it just no longer pretends to
    // be a rare find.
    for (const date of [BEFORE, ON]) {
      expect(evaluateSubmission("asphyxiates", "PHY", [], date).ok).toBe(true);
      expect(evaluateSubmission("meatloaves", "OA", [], date).ok).toBe(true);
    }
  });
});
