// @ts-expect-error -- Node builtin; no @types/node, available under vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIQUID_STEM_START,
  RARITY_ORDER,
  REINFLECTION_START,
  baseFormSubstitution,
  rarityFor,
  rarityScore,
} from "./dictionary";
import {
  baseForm,
  doublingTenseStem,
  inflectedFormCandidates,
  inflectionalBaseCandidates,
  prefixBaseCandidates,
} from "./stem";
import { evaluateSubmission, sameRootKey } from "./submit";
import { MODE_CHOICE_START, asMode } from "./mode";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
import foldReviewVerdictData from "../data/fold-review-verdicts.json";
import boundResidueData from "../data/bound-residues.json";
import measurementUnitData from "../data/measurement-units.json";
import type { AcceptedWord } from "./types";

/**
 * The corpus headword list, decoded straight off disk and cached.
 *
 * `corpusAttests` would be the honest question, but it needs `loadCorpus` and a
 * stubbed fetch, and this suite is deliberately corpus-free everywhere else --
 * see corpus-lexicon.test.ts, which owns that setup. Membership of words.txt is
 * enough for what this pin asks: whether the entry names a real headword or a
 * typo. Front-coded, so it has to be expanded (see `expand` in corpus.ts).
 */
let corpusWordCache: Set<string> | undefined;
function corpusHeadwords(): Set<string> {
  if (corpusWordCache) return corpusWordCache;
  const lines = readFileSync("public/corpus/words.txt", "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const out = new Set<string>();
  let previous = "";
  for (const line of lines) {
    const word = previous.slice(0, line.charCodeAt(0) - 48) + line.slice(1);
    out.add(word);
    previous = word;
  }
  corpusWordCache = out;
  return out;
}

/**
 * Whether `word` came out of a cutover *rarer* than it went in.
 *
 * Several reviewed changes now land on MODE_CHOICE_START and they pull opposite
 * ways: a prefix cutover hands a word a fold it did not have, which makes it
 * commoner, while the 2026-09-22 semantic audit withdraws folds that were
 * landing on the wrong word, which makes them rarer. A ledger counting the sum
 * could state neither.
 *
 * Direction separates them rather than spelling, because the two overlap:
 * thirteen "anti-"/"counter-" words and eleven "pre-" words carry an
 * exemption of their own. One word's score cannot move one way for both reasons, so
 * whichever way it moved names the change that owns it.
 */
function lostAFold(word: string, before: string, after: string): boolean {
  return rarityFor(word, after)!.zipf < rarityFor(word, before)!.zipf;
}

// The 2026-08-21 cutover: a plural or third-person form no longer out-scores the
// word it came from. Expected values are hardcoded rather than recomputed through
// the functions under test, matching scoring.test.ts, so a regression in the fold
// rules or the frequency data is actually caught.
const BEFORE = "2026-08-20"; // last day on the chained-base-only system
const ON = "2026-08-21"; // first day the number inflections fold
// The 2026-08-24 cutover: the fold also runs from a word toward its own
// inflections, so a lemma nobody writes stops out-scoring the form everybody does.
const BEFORE_FORMS = "2026-08-23"; // last day the fold ran one way only
const ON_FORMS = "2026-08-24"; // first day a word caps at its own inflections

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
    // "-es" -> "-is": the Greek and Latin plurals spelled with a vowel change.
    ["analyses", "analysis", 5.8, 4.15],
    ["crises", "crisis", 6.12, 4.57],
    ["emphases", "emphasis", 8.12, 5.21],
    ["oases", "oasis", 7.9, 6.13],
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

// "-ier"/"-iest" rewrites a "-y", so the reading is checkable against the
// dictionary -- the base's other degree must be attested in the same spelling.
// That check is what earns this one family a fold *above* the measurement
// floor, where the gated rules below must not reach.
describe("-ier/-iest comparatives fold onto their -y adjective, above the floor too", () => {
  const DEGREES: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // Measured comparatives that scored rarer than their own adjective.
    ["happier", "happy", 5.4, 3.5],
    ["angrier", "angry", 7.33, 4.52],
    ["earliest", "early", 5.35, 3.38],
    ["prettiest", "pretty", 6.53, 3.46],
    ["busiest", "busy", 6.34, 4.38],
    // Unmeasured ones, where the gate used to be the only path.
    ["babiest", "baby", 10, 3.63],
    ["campier", "campy", 9.97, 7.68],
    ["boniest", "bony", 9.91, 6.59],
  ];

  it.each(DEGREES)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON)).toBe(after);
    expect(score(word, ON)).toBe(score(base, ON));
  });

  it.each(DEGREES)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE)).toBe(before);
  });

  it("refuses an agent noun, whose base lacks the other degree", () => {
    // "copier" is not "more copy": "copiest" is not a word, so the reading
    // fails and the word keeps its own measured score. The same check is what
    // keeps "carrier", "supplier" and "crier" exactly where they were.
    for (const word of ["copier", "carrier", "supplier", "crier", "collier"]) {
      expect(score(word, ON)).toBe(score(word, BEFORE));
      expect(baseFormSubstitution(word, ON)).toBeUndefined();
    }
  });

  it("keeps the -ier/-iest spelling out of the gated bare -er/-est strips", () => {
    // Guessing at that spelling in the gated rule let a junk stem chain
    // somewhere real: "campier" reached "campus" through the non-word-shaped
    // "campi" and out-voted its actual base "campy".
    expect(baseFormSubstitution("campier", ON)?.base).toBe("campy");
    expect(baseFormSubstitution("boniest", ON)?.base).not.toBe("bonus");
  });

  it("keeps its own score when the adjective is rarer", () => {
    // The fold is a cap, never a promotion: "mopy" is rarer than "mopier", so
    // the comparative keeps its own measurement.
    expect(score("mopier", ON)).toBe(score("mopier", BEFORE));
  });
});

// The Latin "-a"/"-i"/"-ae" plurals fold wherever the word has no English
// plural of its own -- above the measurement floor too, since "alba" (3.33) is
// more common than "curricula" and no frequency line separates them.
describe("Latin plurals fold when the word has no English plural of its own", () => {
  const LATIN: ReadonlyArray<[word: string, base: string]> = [
    ["aquaria", "aquarium"],
    ["addenda", "addendum"],
    ["maxima", "maximum"],
    ["curricula", "curriculum"],
    ["momenta", "momentum"],
  ];

  it.each(LATIN)("%s scores as %s from the cutover on", (word, base) => {
    expect(score(word, ON)).toBe(score(base, ON));
    expect(baseFormSubstitution(word, ON)?.base).toBe(base);
  });

  it("refuses a word that takes an English plural of its own", () => {
    // "albas", "taxis", "braes" and "aluminas" are all dictionary words, so
    // "alba", "taxi", "brae" and "alumina" are English singulars whatever
    // their endings suggest -- an oxide is a substance, not a plural.
    for (const word of ["alba", "taxi", "brae", "alumina", "magnesia", "tantra"]) {
      expect(baseFormSubstitution(word, ON), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON)).toBe(score(word, BEFORE));
    }
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

  it.each([
    ["bares", "bar"],
    ["fares", "far"],
    ["fores", "for"],
    ["mares", "mar"],
    ["resites", "resit"],
    ["sires", "sir"],
    ["stares", "star"],
    ["tares", "tar"],
    ["wares", "war"],
  ])("keeps %s on its own data rather than folding to coincidental %s", (word, coincidence) => {
    // A terminal-e base makes both the intended "-s" strip and an unrelated
    // "-es" strip plausible. The max-over-candidates fold would otherwise
    // select the more common coincidence (for example, fores -> for).
    expect(baseFormSubstitution(word, ON)).toBeUndefined();
    const index = (dictionaryWords as unknown as string[]).indexOf(word);
    expect(rarityFor(word, ON)!.zipf).toBe(rarityData.zipfHundredths[index] / 100);
    expect(score(word, ON)).not.toBe(score(coincidence, ON));
  });
});

// src/data/fold-exemptions.json says the one thing an override cannot: score
// this word on its own data. An exempt word contributes no fold candidates, so
// it neither folds nor lets a chain pass through it.
describe("reviewed fold exemptions", () => {
  it("keeps a loanword the spelling rules misread on its own score", () => {
    // "momser" is Yiddish (from mamzer), not "more mom"; "limen" is the
    // psychophysics threshold, not the plural of "liman"; "germen" is the
    // botanical rudiment, not the plural of "german".
    // ... and "complices" is the plural of the archaic "complice", not a
    // stem-change plural of "complex". Its true base is *rarer* than it, so no
    // override can express the redirect -- the cap ignores a rarer base -- and
    // its own measurement is the right score.
    for (const word of ["momser", "limen", "germen", "complices"]) {
      expect(baseFormSubstitution(word, ON), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON)).toBe(score(word, BEFORE));
    }
  });

  it("blocks the chain from passing through an exempt word", () => {
    // "momsers" can only reach "mom" through "momser"; with the exemption in
    // the way it caps at "momser" itself and stays where the loanword stays.
    expect(baseFormSubstitution("momsers", ON)?.base).toBe("momser");
    expect(score("momsers", ON)).toBe(score("momser", ON));
  });

  it("carries a verb's whole paradigm with one entry", () => {
    // The tenses of "rightsize" fold through their verb (see izeVerbSpellings),
    // so exempting the verb keeps every form on the paradigm's own data.
    expect(score("rightsize", ON)).toBe(score("rightsize", BEFORE));
    expect(baseFormSubstitution("rightsizes", ON)?.base).toBe("rightsize");
    expect(baseFormSubstitution("laterized", ON)?.base).toBeUndefined();
  });

  it("shares no word with the override file", () => {
    // A blanket exemption silences every rule including the override, so a word
    // in both files would have a dead override -- a review error, not a tie. A
    // prefix-scoped one leaves the override running, so it is exempt from this.
    const overrides = new Set(Object.keys(scoreOverrideData));
    for (const [word, entry] of Object.entries(foldExemptionData)) {
      if ((entry as { scope?: string }).scope !== undefined) continue;
      expect(overrides.has(word), `${word} is in both curated files`).toBe(false);
    }
  });

  it("names only lexicon words, dates every entry, and scopes them legibly", () => {
    const words = new Set(dictionaryWords as string[]);
    for (const [word, entry] of Object.entries(foldExemptionData)) {
      const { since, scope } = entry as { since: string; scope?: string };
      // Curated for the entries written while the fold priced against the
      // curated list, and the corpus headwords too from the day it stopped.
      //
      // The table has to be able to name whatever the fold can reach, or the
      // one reviewed way to overrule a bad fold stops working for 1.2M of the
      // words that have one. "airshower" is a real headword, folds to
      // "airshow", and means a cascade of cosmic-ray particles; before the
      // cutover there was no such fold to overrule, and no such entry to write.
      // See CORPUS_ONLY_START.
      // Corpus headwords are nameable from the day the fold can price against
      // them -- see CORPUS_ONLY_START, which LIQUID_STEM_START shares.
      const known =
        since >= LIQUID_STEM_START
          ? words.has(word) || corpusHeadwords().has(word)
          : words.has(word);
      expect(known, `${word} is in neither lexicon`).toBe(true);
      expect(since >= "2026-08-21").toBe(true);
      // The only scope the engine knows. A typo would read as a blanket
      // exemption and silently take a word's ordinary folds down with it.
      if (scope !== undefined) expect(scope, `${word} has an unknown scope`).toBe("prefix");
    }
  });

  it("scopes an entry to the prefix only where the residue is a real word", () => {
    // The division between this file and bound-residues.json. A residue that is
    // never a word belongs in the table, where one entry covers every compound
    // built on it; a word whose residue *is* a word and whose split is wrong
    // belongs here, because nothing is wrong with the residue in general.
    const residues = new Set(Object.keys(boundResidueData));
    for (const [word, entry] of Object.entries(foldExemptionData)) {
      if ((entry as { scope?: string }).scope !== "prefix") continue;
      // Asked with "pre-" on, the superset: a scoped entry written for an
      // archived puzzle is checked against the residues that puzzle offered.
      for (const residue of prefixBaseCandidates(word, { pre: true, borrowed: true })) {
        expect(residues.has(residue), `${word} could have been a ${residue} table entry`).toBe(
          false
        );
      }
    }
  });
});

// src/data/fold-review-verdicts.json is the fold review page's own file: the
// verdicts reached at /fold and exported by scripts/export-fold-rejections.mjs.
// A verdict naming a base behaves like an override, one naming none like an
// exemption -- same effects as the curated tables, kept apart so a scoring line
// can be traced to who decided it and how.
describe("reviewed fold verdicts", () => {
  it("shares no word with either curated table", () => {
    // The curated tables are read first and win, so a word in both would leave
    // a dead entry here -- a review error rather than a tie.
    const overrides = new Set(Object.keys(scoreOverrideData));
    const exemptions = new Set(Object.keys(foldExemptionData));
    for (const word of Object.keys(foldReviewVerdictData)) {
      expect(overrides.has(word), `${word} is also a curated override`).toBe(false);
      expect(exemptions.has(word), `${word} is also a curated exemption`).toBe(false);
    }
  });

  it("names lexicon words on both sides and dates every entry", () => {
    const words = new Set(dictionaryWords as string[]);
    const known = (word: string) => words.has(word) || corpusHeadwords().has(word);
    for (const [word, entry] of Object.entries(foldReviewVerdictData)) {
      const { base, since } = entry as { base: string | null; since: string };
      expect(known(word), `${word} is in neither lexicon`).toBe(true);
      // A base the lexicon does not have is dropped at scoring time, which would
      // make the entry a silent no-op -- the one failure mode a reviewed
      // judgement must not have.
      if (base !== null) {
        expect(known(base), `${word} recommends ${base}, which is in neither lexicon`).toBe(true);
        expect(base, `${word} folds to itself`).not.toBe(word);
      }
      expect(/^\d{4}-\d{2}-\d{2}$/.test(since), `${word} has no usable since date`).toBe(true);
    }
  });
});

// src/data/measurement-units.json is what a measurement modifier is allowed to
// fold onto. An *allow*-list, where the bound residues below deny, because the
// risk runs the other way: an unlisted unit costs one word a fold it could have
// had, while a wrongly listed one gives a real unit a frequency collected from
// something else.
describe("reviewed measurement units", () => {
  const ON_UNITS = "2026-09-02";
  const entries = Object.entries(
    measurementUnitData as Record<string, { since: string; note?: string }>
  );

  it("ships a table, so the cases above are not vacuous", () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it.each(entries)("%s is a dictionary word a modifier could reach", (unit) => {
    // An entry the dictionary does not list can never match, so it is dead
    // weight and usually a typo.
    expect(rarityFor(unit), `${unit} is not a dictionary word`).toBeDefined();
  });

  it.each(entries)("%s is dated into the current era", (_unit, entry) => {
    expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Adding an entry *lowers* the scores of everything that folds through it,
    // so an archived puzzle must never see one reviewed after it was played.
    expect(entry.since >= "2026-09-02").toBe(true);
  });

  it("holds back the spellings that are really another word", () => {
    // Asserted on the data as well as on the behaviour, because this is the
    // table's one recurring judgement call and the two are separable: a later
    // rule change could stop "centiares" folding for some unrelated reason and
    // leave the wrong entry sitting here. "are" is the verb, "base" the ordinary
    // noun, and "ares" goes with "are" because the chain walks a plural to its
    // singular. See MEASUREMENT_UNITS in dictionary.ts.
    for (const spelling of ["are", "ares", "base", "bases"]) {
      expect(Object.keys(measurementUnitData), spelling).not.toContain(spelling);
    }
  });

  it("lists both spellings of a unit that has two, and the plurals", () => {
    // Deriving the plural from the singular is what folded "microtones" onto
    // the mass unit through "ton", so the residues are listed outright --
    // "kilojoules" strips to "joules", never to "joule".
    for (const unit of ["meter", "metre", "gram", "gramme", "liter", "litre"]) {
      expect(Object.keys(measurementUnitData), unit).toContain(unit);
    }
    for (const plural of ["joules", "bytes", "grams", "metres", "watts", "seconds"]) {
      expect(Object.keys(measurementUnitData), plural).toContain(plural);
    }
  });

  it("never raises a score, whatever a later entry is added for", () => {
    // The invariant the whole family rests on: a fold caps, so a unit rarer than
    // the word built on it is inert rather than a promotion. Checked over every
    // word the table can reach rather than over a sample.
    const units = new Set(Object.keys(measurementUnitData));
    let checked = 0;
    for (const word of dictionaryWords as string[]) {
      const base = baseFormSubstitution(word, ON_UNITS);
      if (!base || !units.has(base.base)) continue;
      checked += 1;
      expect(score(word, ON_UNITS), `${word} rose to ${base.base}`).toBeLessThanOrEqual(
        score(word, "2026-09-01")
      );
    }
    // Non-vacuity: the loop has to be finding the family it is asserting about.
    expect(checked).toBeGreaterThan(300);
  });
});

// src/data/bound-residues.json is the prefix half of what the bound *suffix*
// rules get from their ending: a closed list of the forms a fold may not land
// on, because they are not words. It replaced a flat Zipf-3 floor, which asked
// "is this residue common" when the question is "is this residue a word".
describe("reviewed bound prefix residues", () => {
  const entries = Object.entries(
    boundResidueData as Record<string, { since: string; reason?: string }>
  );

  it("ships a table, so the cases above are not vacuous", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it.each(entries)("%s is a dictionary word the prefix rule could reach", (residue) => {
    // An entry naming something the dictionary does not list is dead weight and
    // usually a typo. The table exists to refuse residues the engine can
    // actually produce.
    expect(rarityFor(residue), `${residue} is not a dictionary word`).toBeDefined();
  });

  it.each(entries)("%s is dated into the current era", (_residue, entry) => {
    expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Adding an entry *raises* the scores of everything that folded through it,
    // so an archived puzzle must never see one reviewed after it was played.
    expect(entry.since >= "2026-08-26").toBe(true);
  });

  it.each(entries)("%s carries the review note that justifies it", (_residue, entry) => {
    // Nothing reads `reason`, and that is exactly why it needs asserting: this
    // is a table of lexical judgements, and an entry without one cannot be
    // re-reviewed when the dictionary or the frequency data moves.
    expect(entry.reason?.length ?? 0).toBeGreaterThan(20);
  });

  it("spans the frequency range, which is why a floor could not do this job", () => {
    // The substantive claim behind the table. If the bound forms clustered
    // anywhere in particular a threshold would have found them; they do not.
    const zipfByWord = new Map(
      (dictionaryWords as string[]).map((w, i) => [w, rarityData.zipfHundredths[i] / 100])
    );
    const zipfs = entries.map(([residue]) => zipfByWord.get(residue)!);
    expect(Math.min(...zipfs)).toBeLessThan(1.5);
    expect(Math.max(...zipfs)).toBeGreaterThan(2.5);
    // And the real bases sit inside that same range, interleaved with them.
    for (const base of ["gird", "allot", "snob", "emote", "swum", "bade", "aural"]) {
      expect(zipfByWord.get(base)!).toBeGreaterThan(Math.min(...zipfs));
      expect(zipfByWord.get(base)!).toBeLessThan(Math.max(...zipfs) + 1);
    }
  });
});

describe("a conjugation displays what its verb displays", () => {
  // Stripping "-izes" in one bite reached the stem directly ("womanizes" ->
  // "woman") while the verb itself, measured just above the floor, was gated
  // out of the very same strip -- so the conjugation scored 6 points more
  // common than the word it conjugates, the mirror image of the bug the fold
  // exists to prevent. A tensed form now folds through its verb, never past
  // it, so the whole paradigm displays one number.
  const PARADIGMS: ReadonlyArray<[verb: string, forms: string[]]> = [
    ["womanize", ["womanizes", "womanized"]],
    ["internationalise", ["internationalises"]],
    ["militarise", ["militarises"]],
  ];

  it.each(PARADIGMS)("%s and its tenses display one score", (verb, forms) => {
    for (const form of forms) {
      expect(score(form, ON)).toBe(score(verb, ON));
    }
  });

  it("keeps the -ization un-sticking working", () => {
    // "winterisation" folds through the dictionary word "winterise" (bound
    // suffix), and the gate at that unmeasured verb is open, so the chain
    // still carries on to "winter".
    expect(score("winterisation", ON)).toBe(score("winter", ON));
  });

  it("keeps a verbless -ises plural from being read as a verb tense", () => {
    // "whatsises" has no verb "whatsise" behind it -- it is the plural of
    // "whatsis", and the -es rules fold it there. The old tensed strip read
    // the ending as a conjugation and carried it to "what", eight points down.
    expect(baseFormSubstitution("whatsises", ON)?.base).toBe("whatsis");
    expect(baseFormSubstitution("appendicitises", ON)?.base).toBe("appendicitis");
    expect(baseFormSubstitution("abatises", ON)?.base).toBe("abatis");
  });

  it("never lets a tensed -ize/-ise form leapfrog its own verb", () => {
    // The whole-dictionary shape of the paradigm rule: wherever the bare verb
    // is a dictionary word, a tensed form's display comes from its own
    // measurement or from a word one attested inflectional hop away -- its
    // verb above all, but also a real word the tense or number rules land on
    // ("emphasised" strips to the noun "emphasis"). What it must never do is
    // out-run every one of those through a derivational strip its own verb is
    // barred from, which is how "womanizes" once displayed 4 points more
    // common than "womanize".
    const words = dictionaryWords as string[];
    const index = new Map(words.map((w, i) => [w, i]));
    const ownZipf = (w: string) => rarityData.zipfHundredths[index.get(w)!] / 100;
    const verbOf = (w: string): string | undefined => {
      for (const suffix of ["izes", "ises", "ized", "ised"]) {
        if (w.endsWith(suffix) && w.length > suffix.length + 3) return w.slice(0, -1);
      }
      for (const suffix of ["izing", "ising"]) {
        if (w.endsWith(suffix) && w.length > suffix.length + 3) return w.slice(0, -3) + "e";
      }
      return undefined;
    };
    const leapfrogs: string[] = [];
    for (const word of words) {
      const verb = verbOf(word);
      if (!verb || !index.has(verb)) continue;
      let ceiling = ownZipf(word);
      const latin = !index.has(word + "s");
      for (const hop of [verb, baseForm(word), ...inflectionalBaseCandidates(word, latin)]) {
        if (index.has(hop)) ceiling = Math.max(ceiling, rarityFor(hop, ON)!.zipf);
      }
      const used = rarityFor(word, ON)!.zipf;
      if (used > ceiling + 1e-9) leapfrogs.push(`${word} ${used} > ${ceiling}`);
    }
    expect(leapfrogs).toEqual([]);
  });
});

describe("a word folds onto its own inflections too (from 2026-08-24)", () => {
  // The fold ran one way for its whole life: it asked what a word could be a
  // form *of*, capped it there, and so stopped a plural out-scoring its
  // singular. Nothing asked the reverse, and English has a large class of verbs
  // where the reverse is what matters -- the bare lemma is genuinely rare in
  // text while the participle everyone writes is ordinary. The engine sold the
  // rarest inflection of a familiar word as a deep-tail find, which is exactly
  // what players reported about "infatuate" (Mythic) against "infatuated"
  // (Rare). 2,087 words displayed Mythic or better and are capped by their own
  // "-ed"/"-ing" form once this runs (5,352 by an inflection of any kind);
  // 24,842 words move in all and none move up, 4,928 of them out of
  // Mythic-or-better. Measured against this branch's base, so the figures are
  // this change alone rather than the whole 2026-08-24 cutover.
  //
  // word, the inflection it caps at, score before the cutover, score on/after.
  const FOLDS: ReadonlyArray<[word: string, form: string, before: number, after: number]> = [
    // The word that prompted the change, and the one the invariant tests below
    // have cited as the old system's worst promotion all along.
    ["infatuate", "infatuated", 9.46, 7.11],
    ["belove", "beloved", 9.75, 5.24],
    // Participle-dominant verbs: the "-ed" form is the adjective everyone knows.
    ["disgruntle", "disgruntled", 9.91, 6.8],
    ["unbridle", "unbridled", 9.83, 7.16],
    ["overjoy", "overjoyed", 9.87, 7],
    ["aggrieve", "aggrieved", 9.77, 7.11],
    ["antiquate", "antiquated", 9.72, 6.87],
    ["enamor", "enamored", 9.78, 7.28],
    ["untap", "untapped", 9.65, 7.05],
    // Gerund-dominant verbs, the same shape one suffix over.
    ["outstand", "outstanding", 9.65, 4.75],
    ["excruciate", "excruciating", 9.75, 6.87],
    // Nouns whose plural is the form in use -- pluralia tantum and near-misses.
    ["measle", "measles", 9.78, 6.47],
    ["shenanigan", "shenanigans", 9.12, 6.65],
    ["battlement", "battlements", 8.77, 7.63],
  ];

  it.each(FOLDS)("%s scores as %s from the cutover on", (word, form, _before, after) => {
    expect(score(word, ON_FORMS)).toBe(after);
    expect(score(word, ON_FORMS)).toBe(score(form, ON_FORMS));
    expect(baseFormSubstitution(word, ON_FORMS)?.base).toBe(form);
  });

  it.each(FOLDS)("%s kept its own (rarer) score the day before", (word, _form, before) => {
    expect(score(word, BEFORE_FORMS)).toBe(before);
  });

  it("carries the whole paradigm to one score", () => {
    // A form reaches the cap through its own base -- "infatuates" folds to
    // "infatuate", which caps at "infatuated" -- so every member of the
    // paradigm displays the same number, which is the point of a fold.
    const displayed = ["infatuate", "infatuates", "infatuating", "infatuated"].map((w) =>
      score(w, ON_FORMS)
    );
    expect(displayed).toEqual([7.11, 7.11, 7.11, 7.11]);
    // Before the cutover the bare verb and its third person were two ranks
    // above the participle.
    expect(["infatuate", "infatuates", "infatuating", "infatuated"].map((w) => rank(w, BEFORE_FORMS)))
      .toEqual(["Mythic", "Mythic", "Elusive", "Rare"]);
  });
});

describe("what the second direction refuses to fold", () => {
  it("requires the form to *choose* this word, not merely offer it", () => {
    // The forward rules propose every plausible spelling and then narrow to the
    // most common. A candidate check would have been enough to link a word to
    // any form that could be read its way; the reverse fold demands the form
    // actually pick it.
    //
    // "wives" proposes "wife", "wif", "wiv" and "wive"; "wife" wins, so the
    // archaic verb "wive" is not the singular of anything here. "singes" and
    // "singing" both lose their picks to "sing", which "singe" is not.
    for (const word of ["wive", "singe"]) {
      expect(baseFormSubstitution(word, ON_FORMS), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON_FORMS)).toBe(score(word, BEFORE_FORMS));
    }
  });

  it("never walks on from an inflection it capped against", () => {
    // A cap needs only the form's own frequency, so the walk stops there. Left
    // free to continue, one reverse hop and one forward hop compose into a link
    // between different paradigms: "singe" legitimately reaches its own
    // "singes" (the "-es" strip reads either "singe" or "sing"), and carrying on
    // would have landed on "sing" and scored a rare verb as an everyday one.
    // "thee" reached "the" the same way, through "thees".
    expect(score("singe", ON_FORMS)).toBe(7.8);
    expect(score("singe", ON_FORMS)).not.toBe(score("sing", ON_FORMS));
    expect(score("thee", ON_FORMS)).toBe(5.43);
    expect(score("thee", ON_FORMS)).not.toBe(score("the", ON_FORMS));
  });

  it("keeps the reviewed homographs on their own score", () => {
    // Words whose "inflection" is a different word that merely spells the part.
    // Each is a forward misread that was inert while folds only ran one way --
    // a cap cannot pull a word toward rare -- and each bites in this direction,
    // so each got an exemption reviewed for this cutover: "does" is the
    // auxiliary, not the plural of a deer; "morning" is not "morn" progressive;
    // "species" has no singular; "politics" and "physics" are discipline nouns.
    for (const word of ["doe", "morn", "blee", "specie", "genu", "politic", "physic", "tetri", "sacre"]) {
      expect(baseFormSubstitution(word, ON_FORMS), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON_FORMS)).toBe(score(word, BEFORE_FORMS));
    }
  });

  it("leaves a word that is nobody's base alone", () => {
    // The rule caps a word at *its own* forms. A word with no attested
    // inflection keeps its measurement, however rare -- the genuine finds the
    // deep tail exists for are untouched.
    for (const word of ["enshittification", "endling", "fenestron"]) {
      expect(score(word, ON_FORMS)).toBe(score(word, BEFORE_FORMS));
    }
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
  const CHAINED_ERA = [
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-24",
    "2026-09-10",
    "2027-06-01",
    undefined,
  ];

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

  it("raises no score at the 2026-08-26 cutover except where review says so", () => {
    // The invariant PR #209 lacked, and the reason it shipped 13 promotions
    // green: every cutover before it had a demote-only test, and that one had
    // no counterpart. The 2026-08-26 changes widen `nextBaseForms`, and a
    // widened candidate set can only lower a score -- unless it unlinks a pair
    // somewhere else, which is exactly the failure the round-trip repair fixes.
    // So this is not a restatement of the cap, it is the test that the repair
    // is complete.
    //
    // The named exceptions are reviewed corrections rather than side effects.
    // `lade` and its forms scored as a *boy*: the "-es"/"-ed" strip offers both
    // `lade` and `lad`, and `lad` is 1.53 Zipf commoner, so it won the pick and
    // took the whole paradigm with it. Pinning the forms to their own gerund
    // corrects that and raises them, which is the same call the entry below
    // records for "fores" -> "for": lexical correctness wins over preserving an
    // accidental score. (`lade` itself is not in the list -- pinned to the same
    // gerund, it goes *down*.)
    const REVIEWED_RAISES = ["laded", "lades", "lading", "ladings"];
    const raised: string[] = [];
    for (const word of words) {
      const before = rarityScore(rarityFor(word, "2026-08-25")!.zipf, "2026-08-25");
      const after = rarityScore(rarityFor(word, "2026-08-26")!.zipf, "2026-08-26");
      if (after > before + 1e-9) raised.push(word);
    }
    expect(raised.sort()).toEqual(REVIEWED_RAISES);
  });

  it("moves thousands of words down at that cutover, so the case above is not vacuous", () => {
    let lowered = 0;
    for (const word of words) {
      const before = rarityScore(rarityFor(word, "2026-08-25")!.zipf, "2026-08-25");
      if (rarityScore(rarityFor(word, "2026-08-26")!.zipf, "2026-08-26") < before - 1e-9) lowered++;
    }
    expect(lowered).toBeGreaterThan(4000);
  });

  it("leaves a paradigm more coherent than it found it", () => {
    // The measure PR #209 failed and nothing was watching: how far apart the
    // members of one paradigm can score. Widening the fold demotes a word whose
    // own inflection is measured on the other side of MEASURED_FLOOR and cannot
    // follow, so a change that only adds folds pulls families apart -- #209
    // took 341 more paradigms over a two-rank spread than it found. Asserted as
    // a ceiling on the count rather than an exact number so the frequency data
    // can move, and low enough that regressing to the old behaviour fails.
    const scoreAt = (word: string, date: string) =>
      rarityScore(rarityFor(word, date)!.zipf, date);
    const rankIndex = new Map(RARITY_ORDER.map((r, i) => [r, i]));
    const parent = new Map<string, string>();
    const find = (w: string): string => {
      let root = w;
      while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    const union = (a: string, b: string) => {
      parent.set(a, parent.get(a) ?? a);
      parent.set(b, parent.get(b) ?? b);
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) parent.set(ra, rb);
    };
    const dictionary = new Set(words);
    for (const word of words) {
      for (const form of inflectedFormCandidates(word)) {
        if (dictionary.has(form)) union(word, form);
      }
    }
    const families = new Map<string, string[]>();
    for (const word of parent.keys()) {
      const root = find(word);
      families.set(root, [...(families.get(root) ?? []), word]);
    }
    const spread = (family: string[], date: string) => {
      const ranks = family.map((w) => rankIndex.get(rarityFor(w, date)!.rarity)!);
      return Math.max(...ranks) - Math.min(...ranks);
    };
    let before = 0;
    let after = 0;
    for (const family of families.values()) {
      if (family.length < 2) continue;
      if (spread(family, "2026-08-25") >= 2) before++;
      if (spread(family, "2026-08-26") >= 2) after++;
    }
    // 2,208 -> 1,444 as it stands, a third fewer. The ceiling leaves room for a
    // data refresh to move families across a band without failing the suite,
    // and is far below the 2,208 a regression would return to.
    expect(before).toBeGreaterThan(2000);
    expect(after).toBeLessThan(1700);
    // Kept honest: a rule that folded nothing would also pass the line above.
    expect(scoreAt("semiweekly", "2026-08-26")).toBe(scoreAt("semiweeklies", "2026-08-26"));
  });

  it("raises scores only for reviewed lexical-correctness exemptions", () => {
    // Every fold is a cap, and the latest system's candidate set is a superset of
    // the older one's, so the maximum it takes can only rise -- which can only
    // push a score down. A word scoring *higher* than it did means a fold pruned
    // a branch the older system reached. The reviewed exemptions deliberately
    // do so when that branch is an unrelated real word (for example, fores ->
    // for): lexical correctness wins over preserving that accidental score.
    const raised: string[] = [];
    for (const word of words) {
      const before = rarityScore(rarityFor(word, BEFORE)!.zipf, BEFORE);
      const after = rarityScore(rarityFor(word, ON)!.zipf, ON);
      if (after > before + 1e-9) raised.push(word);
    }
    expect(raised).toEqual([
      "bares",
      "fares",
      "fores",
      "mares",
      "resites",
      "sires",
      "stares",
      "tares",
      "wares",
    ]);
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
    // which words a player may submit, not just what they are worth, so it was
    // left as a separate decision; it was taken separately at the 2026-08-24
    // same-root cutover (see src/game/same-root.test.ts), which is why both dates
    // here are before it.
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

// The 2026-08-24 cutover: the derivational families whose ending is *bound* --
// a string English only produces by attaching that suffix -- fold onto their
// base, ungated by MEASURED_FLOOR like the "-ization"/"-ability" pair before
// them. See derivedBaseCandidates in stem.ts.
const BEFORE_DERIVED = "2026-08-23"; // last day before the bound derivations fold
const ON_DERIVED = "2026-08-24"; // first day they fold

describe("bound derivational suffixes fold onto their base (from 2026-08-24)", () => {
  const FOLDS: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // "-ically" -> "-ic": the adverbs the "-ly" rule cannot reach, because the
    // "-ical" adjective it strips back to is usually not a word. The largest
    // family the engine was leaving unfolded, and the one holding the most
    // undeserved top-rank scores.
    ["catholically", "catholic", 9.94, 4.68],
    ["arctically", "arctic", 9.99, 5.44],
    ["toxically", "toxic", 9.72, 5.13],
    ["musically", "music", 4.74, 3.25],
    // "-ably"/"-ibly" -> "-able"/"-ible". unmeasuredBaseCandidates strips these
    // to the bare stem and only below the floor, so a measured adverb never
    // reached the adjective one step up.
    ["availably", "available", 9.36, 3.6],
    ["susceptibly", "susceptible", 9.92, 5.97],
    ["valuably", "valuable", 9.52, 4.74],
    ["negligibly", "negligible", 8.84, 6.38],
    // "-ologist" -> "-ology": every one is the agent noun of an "-ology".
    ["mythologist", "mythology", 9.53, 6.02],
    ["technologist", "technology", 7.27, 3.88],
    ["apologist", "apology", 7.3, 5.41],
    // "-cked"/"-cking" -> "-c": the k English inserts to keep a final c hard.
    // baseForm lands on the non-word "panick", because "ck" is not a doubled
    // consonant and stripDoubledConsonant leaves it alone.
    ["panicked", "panic", 6.37, 5.1],
    ["trafficking", "traffic", 5.63, 4.24],
    ["picnicked", "picnic", 9.31, 5.78],
    ["talcking", "talc", 10, 7.66],
    // "-eaux" -> "-eau": the French plural. No other word ends this way.
    ["bureaux", "bureau", 8.18, 4.88],
    ["chateaux", "chateau", 8.24, 6.52],
  ];

  it.each(FOLDS)("scores %s as %s from the cutover", (word, base, before, after) => {
    expect(score(word, BEFORE_DERIVED)).toBe(before);
    expect(score(word, ON_DERIVED)).toBe(after);
    expect(score(word, ON_DERIVED)).toBe(score(base, ON_DERIVED));
    expect(baseFormSubstitution(word, BEFORE_DERIVED)?.base).not.toBe(base);
    expect(baseFormSubstitution(word, ON_DERIVED)?.base).toBe(base);
  });

  it("retires the top ranks these words were wearing for an ending", () => {
    expect(rank("catholically", BEFORE_DERIVED)).toBe("Legend");
    expect(rank("catholically", ON_DERIVED)).toBe("Common");
    expect(rank("susceptibly", BEFORE_DERIVED)).toBe("Legend");
    expect(rank("susceptibly", ON_DERIVED)).toBe("Uncommon");
    expect(rank("mythologist", BEFORE_DERIVED)).toBe("Mythic");
    expect(rank("mythologist", ON_DERIVED)).toBe("Uncommon");
  });

  it("picks the -ck base over the -c one where that is the real verb", () => {
    // "chocked" is a tense of "chock" (to wedge), not of "choc". Both spellings
    // are offered and the most-common check settles it.
    expect(baseFormSubstitution("chocked", ON_DERIVED)?.base).toBe("chock");
    expect(baseFormSubstitution("crocked", ON_DERIVED)?.base).toBe("crock");
    expect(baseFormSubstitution("cricked", ON_DERIVED)?.base).toBe("crick");
    // The one exception, pinned so it can't drift unnoticed: "spec" (3.59) is
    // commoner than the real base "speck" (3.02), so "specked" takes it and
    // scores 0.84 low. A 0.57-Zipf gap is the harmless near-tie shape, and an
    // override can't fix it -- the word already folds to "speck" through the
    // plain "-ed" rule, so the entry would move no score.
    expect(baseFormSubstitution("specked", ON_DERIVED)?.base).toBe("spec");
  });

  it("reaches the shortest member of each family", () => {
    // A length bound one letter too high silently drops a member: "epically",
    // "stably", "oologist" and "beaux" are the shortest words their rules have.
    for (const [word, base] of [
      ["epically", "epic"],
      ["stably", "stable"],
      ["viably", "viable"],
      ["oologist", "oology"],
      ["beaux", "beau"],
    ] as const) {
      expect(baseFormSubstitution(word, ON_DERIVED)?.base, word).toBe(base);
      expect(score(word, ON_DERIVED)).toBe(score(base, ON_DERIVED));
    }
  });

  it("leaves a candidate rarer than the word itself inert", () => {
    // The fold caps rather than inherits, so a base that is *rarer* than the
    // word can never fire. "physic" and "critic" are both real words and both
    // proposed; both are rarer than the adverbs that reach them, so the adverbs
    // keep their own measured scores. This is what makes the family safe
    // without a frequency gate.
    for (const word of ["physically", "critically", "politically", "historically"]) {
      expect(score(word, BEFORE_DERIVED), `${word} must not move`).toBe(score(word, ON_DERIVED));
    }
  });
});

describe("what the 2026-08-24 cutover deliberately leaves alone", () => {
  it("keeps -cker agent nouns on their own frequency", () => {
    // The c -> ck rewrite covers "-cked"/"-cking" only. An agent noun is at
    // least as likely to be built on a "-ck" verb as on a "-c" one, and the
    // rule folds "blockers" -> "bloc", "crockers" -> "croc" and "specker" ->
    // "spec". The price is that "panicker" keeps an unearned Elusive.
    for (const word of ["blockers", "crockers", "specker", "panicker"]) {
      expect(score(word, BEFORE_DERIVED), `${word} must not move`).toBe(score(word, ON_DERIVED));
    }
  });

  it("leaves the unbound derivational endings alone", () => {
    // "-al", "-ic", "-ity", "-ish", "-let", "-ship" and "-ward" are ordinary
    // word-final material, not bound suffixes: the same strip that fixes a
    // genuine derivation folds "metal" -> "met", "topic" -> "top", "unity" ->
    // "unit", "listless" -> "list", "spaceship" -> "space" and "forward" ->
    // "for". No gate separates those from the real ones, so they stay out.
    for (const word of ["metal", "topic", "unity", "listless", "spaceship", "forward"]) {
      expect(score(word, BEFORE_DERIVED), `${word} must not move`).toBe(score(word, ON_DERIVED));
    }
  });
});

describe("transparent prefixes fold, but only below the measurement floor", () => {
  // The 2026-08-24 cutover. Before it, suffix rules alone left a prefixed word
  // dead-ended on an unattested prefixed stem holding a near-perfect score.
  const BEFORE_PREFIX = "2026-08-23";
  const ON_PREFIX = "2026-08-24";

  const PREFIXED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    ["outwill", "will", 10, 1.88],
    ["overpeople", "people", 10, 2.18],
    ["misthink", "think", 9.96, 2.43],
    // Lands on "baked" rather than "bake" since the 2026-08-24 reverse fold caps
    // a word at the inflections built on it -- the prefix strip still does its
    // half of the work.
    ["underbakes", "baked", 9.96, 5.6],
    ["counterorders", "order", 9.89, 3.3],
    // The chain keeps walking past the immediate parent: "nonplaying" strips
    // its prefix to "playing" and carries on to "play".
    ["nonplaying", "play", 9.69, 3.12],
  ];

  it.each(PREFIXED)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON_PREFIX)).toBe(after);
    expect(baseFormSubstitution(word, ON_PREFIX)?.base).toBe(base);
  });

  it.each(PREFIXED)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_PREFIX)).toBe(before);
  });

  it("gives up the fossilised prefixes, right readings and all", () => {
    // "de-", "re-", "co-" and "dis-" are excluded because English fossilised
    // them onto Latin stems -- see prefixBaseCandidates. These are the words
    // that costs us: every one is a real derivation the rule declines to make.
    //
    // Asserted on the base rather than on the score staying put: the reverse
    // fold shipped on this same date, so "depeople" does move -- onto its own
    // "depeopled". What matters here is that the prefix was never stripped.
    for (const [word, residue] of [
      ["codriver", "driver"],
      ["reexplain", "explain"],
      ["depeople", "people"],
      ["disaffectedness", "affectedness"],
    ] as const) {
      expect(
        baseFormSubstitution(word, ON_PREFIX)?.base,
        `${word} must not reach ${residue}`
      ).not.toBe(residue);
    }
  });

  it("will not fold onto a bound combining form the dictionary happens to list", () => {
    // Stripping a prefix routinely lands on a fragment that is a real
    // dictionary entry and no word's base. They are all in the deep tail, so a
    // minimum frequency on the base keeps them out -- see PREFIX_BASE_MIN_ZIPF.
    //
    // On the base, not the score: several of these do move on this date, but
    // via the reverse fold onto their own plural ("neolith" -> "neoliths").
    // The point is that the combining form is never reached.
    for (const [word, fragment] of [
      ["neolith", "lith"],
      ["monocrat", "crat"],
      ["autophyte", "phyte"],
      ["protopathy", "pathy"],
      ["prelect", "lect"],
      ["subduce", "duce"],
      ["monopode", "pode"],
      ["polyzoic", "zoic"],
    ] as const) {
      expect(
        baseFormSubstitution(word, ON_PREFIX)?.base,
        `${word} must not reach ${fragment}`
      ).not.toBe(fragment);
    }
  });

  it("exempts the one bound form the frequency floor cannot catch", () => {
    // "microdont" is micro- + -odont (tooth). Its residue "dont" is in the
    // dictionary as the apostrophe-less "don't" and carries that word's
    // frequency (Zipf 4.74), so it clears the base floor the others fail. A
    // reviewed fold exemption is the cheaper fix -- see fold-exemptions.json.
    expect(score("microdont", BEFORE_PREFIX)).toBe(score("microdont", ON_PREFIX));
    expect(baseFormSubstitution("microdont", ON_PREFIX)).toBeUndefined();
  });

  it("leaves a word the corpora actually measure alone, however it starts", () => {
    // Ungated the rule folds every one of these onto an unrelated word:
    // "preface" -> "face", "present" -> "sent", "mistake" -> "take",
    // "outrage" -> "rage", "understand" -> "stand". Each carries a real
    // measurement, so the gate excludes it.
    for (const word of [
      "preface",
      "present",
      "mistake",
      "outrage",
      "understand",
      "subject",
      "overture",
      "nonsense",
      "united",
      "postage",
      "interest",
      "supermarket",
    ]) {
      expect(score(word, BEFORE_PREFIX), `${word} must not move`).toBe(score(word, ON_PREFIX));
    }
  });
});

// The 2026-08-26 cutover, where the fold's three remaining frequency guesses are
// replaced by reviewed morphology: which readings of a form are rivals, which
// residues are words, and which half of a noun/adjective pair anyone writes.
// See REVIEWED_FOLD_START in dictionary.ts.
describe("reviewed morphology replaces the fold's frequency guesses (from 2026-08-26)", () => {
  const BEFORE_REVIEWED = "2026-08-25";
  const ON_REVIEWED = "2026-08-26";

  // -- The residue table ------------------------------------------------------

  const RESIDUE_FOLDS: ReadonlyArray<
    [word: string, base: string, before: number, after: number]
  > = [
    // The long derived bases the flat Zipf-3 floor asked to be as common as a
    // five-letter one.
    ["overopinionated", "opinionated", 10, 7.13],
    ["hyperfastidious", "fastidious", 10, 7.49],
    ["nondidactic", "didactic", 9.91, 7.34],
    // The short ones, which no length rule reaches and which the floor refused
    // for being a tenth of a Zipf too rare. "snob" at 2.96 was kept out while
    // "opinionated" at 2.88 would have been let in, had it been shorter.
    ["antisnob", "snob", 10, 7.02],
    ["subaural", "aural", 9.96, 7.28],
    ["overemote", "emote", 10, 7.75],
    ["outswum", "swum", 10, 7.8],
    ["prebade", "bade", 10, 7.43],
  ];

  it.each(RESIDUE_FOLDS)("%s scores as %s from the cutover on", (word, base, _b, after) => {
    expect(score(word, ON_REVIEWED)).toBe(after);
    expect(baseFormSubstitution(word, ON_REVIEWED)?.base).toBe(base);
  });

  it.each(RESIDUE_FOLDS)("%s kept its unearned score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_REVIEWED)).toBe(before);
  });

  it("refuses a bound combining form whatever its length or frequency", () => {
    // The table's whole job, and the reason it is a table: these sit at every
    // length and every frequency the real bases do. "duce" (2.51) and "lect"
    // (1.80) sit either side of "gird" (2.22), which folds correctly.
    for (const [word, fragment] of [
      ["neolith", "lith"],
      ["monocrat", "crat"],
      ["autophyte", "phyte"],
      ["prelect", "lect"],
      ["protopathy", "pathy"],
      ["autocade", "cade"],
      ["prepone", "pone"],
      ["monopode", "pode"],
      ["antilogy", "logy"],
      ["polyzoic", "zoic"],
      ["macrography", "graphy"],
      ["polymerous", "merous"],
      ["monogenies", "genies"],
      ["neophilia", "philia"],
      ["monogenous", "genous"],
      ["nonparous", "parous"],
      ["ultraistic", "istic"],
      ["misologist", "ologist"],
      ["photometrist", "metrist"],
      ["polyonymous", "onymous"],
    ] as const) {
      expect(
        baseFormSubstitution(word, ON_REVIEWED)?.base,
        `${word} must not reach ${fragment}`
      ).not.toBe(fragment);
    }
  });

  it("keeps a residue that only looks bound, where the word really is one", () => {
    // Homographs of the combining forms, and the reason the table is keyed on
    // residues that are checked one at a time rather than on a suffix pattern:
    // "lithic" is a real adjective though "lith" is not, and "phylum" a real
    // noun though "phyte" is not.
    for (const [word, base] of [
      ["protolithic", "lithic"],
      ["superphylum", "phylum"],
      ["autogamic", "gamic"],
      ["antitypic", "typic"],
      ["pseudocelom", "celom"],
      ["suboscine", "oscine"],
      ["hyperploidy", "ploidy"],
      ["monostrophe", "strophe"],
    ] as const) {
      expect(
        baseFormSubstitution(word, ON_REVIEWED)?.base,
        `${word} should still reach ${base}`
      ).toBe(base);
    }
  });

  it("still leaves a word the corpora measure alone", () => {
    // MEASURED_FLOOR is untouched: the residue table decides which residues are
    // words, not which words the prefix rule may run on. Ungated it folds every
    // one of these onto an unrelated word.
    for (const word of [
      "monolith",
      "preface",
      "present",
      "mistake",
      "outrage",
      "understand",
      "subject",
      "overture",
      "nonsense",
      "united",
      "postage",
      "interest",
      "supermarket",
    ]) {
      expect(score(word, BEFORE_REVIEWED), `${word} must not move`).toBe(score(word, ON_REVIEWED));
    }
  });

  // -- Wrong bracketings, and the scope that keeps them from over-reaching ----

  it("refuses the wrong bracketings whose residue is a real word", () => {
    // No residue table can see these: "phonic", "regnal", "visional" and
    // "erose" are all words, and only the split is wrong. Reviewed entries in
    // fold-exemptions.json, scoped to the prefix.
    for (const word of [
      "antiphonic",
      "interregnal",
      "televisional",
      "nonagonal",
      "ungular",
      "previsor",
      "intermissive",
      "suberose",
    ]) {
      expect(baseFormSubstitution(word, ON_REVIEWED), `${word} must not fold`).toBeUndefined();
    }
  });

  it("scopes those entries to the prefix, so an ordinary fold survives", () => {
    // The half PR #209 got wrong. "transferals" strips "trans-" to "ferals" on
    // its own, so it needs an entry of its own -- and a blanket one would stop
    // it folding onto "transferal" too, leaving a plural scoring above its
    // singular and a rank higher.
    expect(baseFormSubstitution("transferals", ON_REVIEWED)?.base).toBe("transferal");
    expect(score("transferals", ON_REVIEWED)).toBe(score("transferal", ON_REVIEWED));
  });

  // -- The round trip, and the paradigm --------------------------------------

  it("holds a paradigm together when the forward rules climb past it", () => {
    // The round trip asks its question of the form's *inflectional* readings.
    // Asked of the whole set, "overripening" preferred "ripening" -- a rung
    // above, not a rival -- the pair unlinked, and the lemma floated back up to
    // a score its own forms had just left.
    for (const family of [
      ["overripen", "overripens", "overripened", "overripening"],
      ["unwreathe", "unwreathes", "unwreathed", "unwreathing"],
      ["overdye", "overdyes", "overdyed", "overdyeing"],
      ["counterculturist", "counterculturists"],
      ["hypersensitise", "hypersensitises", "hypersensitised", "hypersensitising"],
    ]) {
      const scores = family.map((w) => score(w, ON_REVIEWED));
      expect(new Set(scores).size, `${family.join("/")} scored ${scores.join("/")}`).toBe(1);
    }
  });

  it("carries a measurement across MEASURED_FLOOR through the paradigm", () => {
    // A confirmed reverse hop is now walked onward through the rungs above it,
    // so a measured lemma reaches the base its own unmeasured forms found. This
    // is the "overbake"/"underbake" cliff -- the word with *more* evidence of
    // use scored 3.6 points rarer -- closed without moving the floor.
    expect(score("overbake", ON_REVIEWED)).toBe(score("underbake", ON_REVIEWED));
    expect(score("semiweekly", ON_REVIEWED)).toBe(score("semiweeklies", ON_REVIEWED));
    expect(score("overbake", BEFORE_REVIEWED)).not.toBe(score("underbake", BEFORE_REVIEWED));
  });

  it("never walks a rival reading of a form onward, which is what stays terminal", () => {
    // The guard the second half could have broken. "cleanses" is both
    // "cleanse" + "-s" and "cleans" + "-es", and following its other reading
    // lands "cleanse" on "clean"; the same composition dragged "thee" onto
    // "the". Only the non-inflectional rungs are followed, and those are never
    // a rival reading.
    for (const word of ["cleanse", "cleanses", "underlie", "singe", "wive", "thee", "wives"]) {
      expect(score(word, BEFORE_REVIEWED), `${word} must not move`).toBe(score(word, ON_REVIEWED));
    }
  });

  // -- The bound derivational forms built on a word --------------------------

  const DERIVED_FORM_FOLDS: ReadonlyArray<
    [word: string, base: string, before: number, after: number]
  > = [
    ["neolith", "neolithic", 9.9, 6.97],
    ["claustrophobe", "claustrophobic", 9.93, 7.18],
    ["paleolith", "paleolithic", 9.91, 7.56],
    ["agoraphobe", "agoraphobic", 9.93, 8.4],
    ["euphemist", "euphemistic", 9.99, 8.36],
    ["nepotist", "nepotistic", 9.91, 8.88],
    ["grume", "grumous", 9.92, 8.43],
    ["monocrat", "monocratic", 9.9, 9.21],
  ];

  it.each(DERIVED_FORM_FOLDS)("%s scores as %s from the cutover on", (word, base, _b, after) => {
    expect(score(word, ON_REVIEWED)).toBe(after);
    expect(baseFormSubstitution(word, ON_REVIEWED)?.base).toBe(base);
  });

  it.each(DERIVED_FORM_FOLDS)("%s kept its own score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_REVIEWED)).toBe(before);
  });

  it("puts the two halves of the same family within a rank of each other", () => {
    // The complaint that prompted the rule: "monolith" is measured and scores
    // Rare, "neolith" is not and scored a perfect Legend, and they are the same
    // word with a different Greek prefix.
    expect(rank("monolith", ON_REVIEWED)).toBe("Rare");
    expect(rank("neolith", ON_REVIEWED)).toBe("Rare");
    expect(Math.abs(score("monolith", ON_REVIEWED) - score("neolith", ON_REVIEWED))).toBeLessThan(
      0.5
    );
  });

  it("leaves the accidental -ic pairs alone, because the floor excludes them", () => {
    // "pan"/"panic", "top"/"topic", "log"/"logic", "ion"/"ionic",
    // "organ"/"organic": nothing in the spelling separates these from
    // "neolith"/"neolithic", and every one of them is a common word sitting far
    // above MEASURED_FLOOR, where this rule never runs.
    for (const word of ["pan", "top", "log", "ion", "organ", "mag", "ton", "class", "eth"]) {
      expect(score(word, BEFORE_REVIEWED), `${word} must not move`).toBe(score(word, ON_REVIEWED));
    }
  });
});

// The 2026-09-02 cutover: the paired-degree check that earned "-ier"/"-iest" a
// fold above the measurement floor, moved to the bare "-est" spelling. Until it
// the gated strip was the only "-est" rule, so every superlative a corpus
// measures kept a score its adjective never had. See SUPERLATIVE_BASE_START in
// dictionary.ts and superlativeBaseCandidates in stem.ts.
describe("bare -est superlatives fold onto their adjective (from 2026-09-02)", () => {
  const BEFORE_SUP = "2026-09-01"; // last day only the gated strip read "-est"
  const ON_SUP = "2026-09-02"; // first day the comparative vouches for the fold

  const SUPERLATIVES: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // The word that prompted the rule, and the shape of the whole family: the
    // superlative is measured, so the gated strip never reached it, and it
    // scored four points rarer than the adjective it is the top degree of.
    ["realest", "real", 8.3, 3.52],
    ["beautifulest", "beautiful", 9.81, 4.08],
    ["perfectest", "perfect", 9.85, 4.1],
    ["blindest", "blind", 9.85, 5.08],
    ["crookedest", "crooked", 9.81, 6.34],
    ["distinctest", "distinct", 9.75, 5.41],
    // The nonstandard superlatives of words that have their own irregular one.
    ["goodest", "good", 8.94, 2.73],
    ["bestest", "best", 7.85, 3.16],
    // Archaic second-person verbs, which end the same way and reach the verb
    // anyway -- "thou knowest" is a form of "know" whichever reading you take.
    ["knowest", "know", 8.35, 2.76],
    ["believest", "believe", 9.56, 3.65],
    // The doubled consonant, the one place a three-letter base is offered: the
    // doubling is itself evidence of the suffix.
    ["biggest", "big", 4.5, 3.41],
    ["hottest", "hot", 5.96, 4.16],
    ["saddest", "sad", 6.88, 4.63],
    // The chain keeps walking, as everywhere else: "littlest" folds through
    // "little", "winningest" through "winning" onto "win".
    ["littlest", "little", 7.66, 3.29],
    ["winningest", "win", 8.19, 3.83],
  ];

  it.each(SUPERLATIVES)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON_SUP)).toBe(after);
    expect(score(word, ON_SUP)).toBe(score(base, ON_SUP));
  });

  it.each(SUPERLATIVES)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_SUP)).toBe(before);
  });

  it("refuses a word whose spelling has no comparative behind it", () => {
    // The check is the whole guard: a word that merely ends in "-est" has no
    // "-er" form in the same spelling, so it never reaches the accidental base
    // underneath it. There is no "conter", "interer", "proter", "postter" or
    // "rearrer".
    for (const word of ["contest", "interest", "protest", "harvest", "posttest", "rearrest"]) {
      expect(score(word, ON_SUP), `${word} must not fold`).toBe(score(word, BEFORE_SUP));
    }
  });

  it("leaves the bare -er comparative behind the floor gate", () => {
    // "-est" takes the paired check and "-er" cannot, because "-er" is also the
    // agentive suffix: the same check passes on "shoulder" -> "should"
    // ("shouldest" is a word), "shower" -> "show", "speaker" -> "speak" and
    // "dweller" -> "dwell". Measured agent nouns keep their own scores.
    for (const word of ["shoulder", "shower", "speaker", "dweller", "earner", "opener"]) {
      expect(score(word, ON_SUP), `${word} must not fold`).toBe(score(word, BEFORE_SUP));
    }
  });

  it("stops at six letters, where the short strips start to miss", () => {
    // At six the "-e" stems are right ("wisest", "latest") and the strips are
    // not ("modest" -> "mode", "divest" -> "dive"), and the words at that length
    // are common enough that the fold has nothing to correct.
    for (const word of ["modest", "divest", "wisest", "latest", "finest", "safest"]) {
      expect(score(word, ON_SUP), `${word} must not fold`).toBe(score(word, BEFORE_SUP));
    }
  });

  it("keeps the two reviewed non-superlatives on their own data", () => {
    // The only two dictionary words that clear the paired-degree check without
    // being superlatives: "earnest" ("earner" is a word) and "tempest"
    // ("temper"). Both are exempt by name -- see fold-exemptions.json.
    for (const word of ["earnest", "tempest"]) {
      expect(baseFormSubstitution(word, ON_SUP), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON_SUP)).toBe(score(word, BEFORE_SUP));
    }
  });

  it("takes the reviewed base where two attested stems compete", () => {
    // "dens" (the plural of den, 4.01) beats "dense" (3.98) on frequency, so the
    // fold chained "densest" onto "den"; "tens" does the same to "tensest". The
    // spelling rules cannot say which stem is the real one, so an override does.
    expect(baseFormSubstitution("densest", ON_SUP)?.base).toBe("dense");
    expect(baseFormSubstitution("tensest", ON_SUP)?.base).toBe("tense");
  });

  it("reads a prefixed superlative as a degree of the prefixed adjective", () => {
    // The bracketing question the prefix hop asks the wrong way round:
    // "uncleanest" is un- + "cleanest" only by accident, and it really is the
    // superlative of "unclean". Stripping the prefix off the degree form came
    // back scoring "most unclean" as `clean`, its own opposite.
    for (const [word, base] of [
      ["uncleanest", "unclean"],
      ["unjustest", "unjust"],
      ["unfairest", "unfair"],
      ["uncommonest", "uncommon"],
      ["unsoundest", "unsound"],
      ["unevenest", "uneven"],
    ] as const) {
      expect(baseFormSubstitution(word, ON_SUP)?.base, word).toBe(base);
    }
    // The adjective's own prefix hop is unaffected -- it is asked at the
    // adjective, once, on the adjective's own measurement.
    expect(score("unclean", ON_SUP)).toBe(score("unclean", BEFORE_SUP));
  });

  it("keeps its own score when the adjective is rarer", () => {
    // A cap, never a promotion, like every other fold: "furth" (2.10) is rarer
    // than "furthest" (3.17), so the superlative keeps its own measurement.
    expect(score("furthest", ON_SUP)).toBe(score("furthest", BEFORE_SUP));
    expect(score("mopier", ON_SUP)).toBe(score("mopier", BEFORE_SUP));
  });
});

// The 2026-09-02 cutover: a measurement modifier is scored as the unit it
// counts. The transparent-prefix argument -- a prefixed word means its base plus
// a modifier -- applied to the one prefix family whose residue can be checked
// against a list rather than guessed at, which is what lets it run above
// MEASURED_FLOOR where `prefixBaseCandidates` cannot. See MEASUREMENT_BASE_START
// in dictionary.ts and measurementBaseCandidates in stem.ts.
describe("measurement modifiers fold onto their unit (from 2026-09-02)", () => {
  const BEFORE_UNITS = "2026-09-01"; // last day a multiplier bought a rarity
  const ON_UNITS = "2026-09-02"; // first day the unit is what the word scores as

  const MODIFIED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // The word that prompted the rule. Measured at Zipf 1.62 and so far above
    // the floor gate that no prefix rule could ever have reached it, yet a full
    // point rarer than the joules it counts.
    ["kilojoules", "joules", 9.08, 7.92],
    ["megabytes", "bytes", 7.96, 6.85],
    ["milliseconds", "second", 7.37, 3.47],
    ["centimeters", "meters", 6.88, 5.52],
    ["kilograms", "grams", 6.88, 6.07],
    ["gigawatts", "watts", 8.32, 6.11],
    // The deep-tail end of the same family: a unit with a multiplier bolted on
    // that no corpus has ever measured, sitting at a flat 10.00 for it.
    ["zeptosecond", "second", 10, 3.47],
    ["exahertz", "hertz", 10, 7.13],
    ["terapixels", "pixel", 10, 6.21],
    ["kilocoulomb", "coulomb", 10, 8.04],
    // The binary modifiers, which are measurement modifiers too.
    ["gibibyte", "bytes", 10, 6.85],
    // Three letters, the length `prefixBaseCandidates` refuses: the unit table
    // is the guard here, so the short units it lists are safe to reach.
    ["milliamps", "amp", 9.3, 6.1],
    ["megaton", "tons", 8.12, 5.17],
    // The chain keeps walking, as everywhere else -- through a second modifier
    // ("micromillimeter") and through an ordinary prefix ("multimegaton").
    ["micromillimeter", "meters", 7.03, 5.52],
    ["multimegaton", "tons", 8.12, 5.17],
  ];

  it.each(MODIFIED)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON_UNITS)).toBe(after);
    expect(score(word, ON_UNITS)).toBe(score(base, ON_UNITS));
  });

  it.each(MODIFIED)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_UNITS)).toBe(before);
  });

  it("names the unit as the base the player is shown", () => {
    expect(baseFormSubstitution("kilojoules", ON_UNITS)?.base).toBe("joules");
    expect(baseFormSubstitution("nanotesla", ON_UNITS)?.base).toBe("tesla");
    expect(baseFormSubstitution("millimicron", ON_UNITS)?.base).toBe("micron");
  });

  it("refuses a word that merely opens with the letters of a modifier", () => {
    // The reason this family cannot borrow `prefixBaseCandidates`' floor gate:
    // the words it exists for are measured, so the gate would refuse them, and
    // the coincidences it would otherwise catch are measured too. Every one of
    // these strips to a real dictionary word -- "dent", "mate", "mine", "ring",
    // "line", "toma", "phone", "pede" -- and the unit table is what refuses them.
    for (const word of [
      "decadent",
      "decimate",
      "examine",
      "hectoring",
      "picoline",
      "petaline",
      "teratoma",
      "megaphone",
      "millipede",
      "centipede",
      "microtones",
    ]) {
      expect(score(word, ON_UNITS), `${word} must not fold`).toBe(score(word, BEFORE_UNITS));
    }
  });

  it("leaves the non-measurement senses of a modifier alone", () => {
    // "micro-", "nano-" and "mega-" are also plain size modifiers, and a
    // microwave is not a wave of anything measurable. The unit table draws that
    // line for free: the residue has to be a unit, not merely a word.
    for (const word of ["microwave", "microscope", "nanotechnology", "megachurch"]) {
      expect(score(word, ON_UNITS), `${word} must not fold`).toBe(score(word, BEFORE_UNITS));
    }
  });

  it("keeps the units whose spelling is really another word off the table", () => {
    // "are" (the 100-square-metre unit) is the verb, "base" (the base pair) is
    // the ordinary noun, and both would have handed a genuine unit a frequency
    // collected from something else entirely -- "centiares" came back at 1.76 as
    // `are`, "kilobase" as `based`. Deliberately absent; see MEASUREMENT_UNITS.
    for (const word of ["centiare", "centiares", "deciares", "kilobase", "megabase"]) {
      expect(score(word, ON_UNITS), `${word} must not fold`).toBe(score(word, BEFORE_UNITS));
    }
  });

  it("admits a unit whose spelling is the ordinary word it is a unit of", () => {
    // The other half of the table's judgement, and the one that looks like the
    // refused cases but is not. "bar", "bit", "second" and "ton" are everyday
    // words, and the unit is the *same* word rather than a homograph of it: a
    // kilobar is a thousand bars of pressure, a gigabit a billion bits. So the
    // fold onto a common word, and the low score it brings, is the rule working.
    for (const [word, base] of [
      ["kilobar", "bar"],
      ["gigabit", "bit"],
      ["millisecond", "second"],
      ["megaton", "tons"],
    ] as const) {
      expect(baseFormSubstitution(word, ON_UNITS)?.base, word).toBe(base);
      expect(score(word, ON_UNITS), word).toBe(score(base, ON_UNITS));
    }
  });

  it("caps rather than promotes, like every other fold", () => {
    // A modifier can only ever pull a word toward its unit's score, never past
    // it. "farad" and "ampere" are rarer than the "microfarad" and
    // "microampere" built on them, so the fold is inert there and the words keep
    // exactly what they had.
    for (const word of ["microfarad", "microfarads", "microampere", "microamperes"]) {
      expect(score(word, ON_UNITS), word).toBe(score(word, BEFORE_UNITS));
    }
  });
});

// The 2026-09-02 cutover: a word "without X" scores as X. The family had no fold
// rule at all before it, so 1,224 words -- every "-less" adjective with a base,
// plus the "-lessly"/"-lessness" derivatives that had folded onto the adjective
// and were sharing its score -- were scored as discoveries. See
// PRIVATIVE_BASE_START in dictionary.ts and privativeBaseCandidates in stem.ts.
describe("privative -less folds onto the word it is the absence of (from 2026-09-02)", () => {
  const BEFORE_PRIV = "2026-09-01"; // last day the suffix carried its own score
  const ON_PRIV = "2026-09-02"; // first day "kindless" scores as `kind`

  const PRIVATIVES: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // The word that prompted the rule: measured at Zipf 1.08, just above the
    // floor gate, so no gated family could ever have reached it.
    ["kindless", "kind", 9.79, 3.74],
    // The rest of the deep-tail end of the family, where the score was furthest
    // from the everyday word the player actually needed to see.
    ["newsless", "new", 9.93, 2.53],
    ["accentless", "accent", 9.41, 5.62],
    ["weariless", "weary", 9.9, 6.37],
    // The everyday members, which were only a rank or two out.
    ["useless", "use", 5.51, 3.2],
    ["endless", "end", 5.57, 3.4],
    ["harmless", "harm", 6.11, 5.16],
    // The "-i" -> "-y" rewrite, the one spelling change the suffix makes.
    ["pitiless", "pity", 8.15, 5.85],
    ["penniless", "penny", 7.41, 5.72],
    // ... including where the plain strip is also a listed word ("bodi", 1.98)
    // and the rewrite has to out-vote it, and where it is not a word at all.
    ["bodiless", "body", 9.12, 3.81],
    ["remediless", "remedy", 8.19, 6.06],
    // The derivatives, which reach the base through the adjective.
    ["kindlessly", "kind", 9.79, 3.74],
    ["faithless", "faith", 7.63, 4.66],
    ["faithlessly", "faith", 7.63, 4.66],
    ["faithlessness", "faith", 7.63, 4.66],
    ["effortlessly", "effort", 6.91, 4.51],
  ];

  it.each(PRIVATIVES)("%s scores as %s from the cutover on", (word, base, _before, after) => {
    expect(score(word, ON_PRIV)).toBe(after);
    expect(score(word, ON_PRIV)).toBe(score(base, ON_PRIV));
  });

  it.each(PRIVATIVES)("%s kept its own, rarer score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_PRIV)).toBe(before);
  });

  it("refuses a word that merely ends in -less", () => {
    // Ungated by MEASURED_FLOOR, so the ending is the whole guard -- and it
    // holds because the strip is decisive: English writes "-less" onto a noun
    // and takes nothing away, so a word that is not built that way leaves a
    // residue no dictionary attests ("bless" -> "b", "unless" -> "un",
    // "nevertheless" -> "neverthe", "natheless" -> "nath").
    const merely = ["bless", "unless", "nevertheless", "nonetheless", "natheless", "irregardless"];
    for (const word of merely) {
      expect(score(word, ON_PRIV), `${word} must not fold`).toBe(score(word, BEFORE_PRIV));
    }
  });

  it("keeps its own score where the base is rarer", () => {
    // A cap, never a promotion, like every other fold: "feck" (2.24) is rarer
    // than "feckless" (2.48), and there is no "reck" or "gorm" in circulation
    // either. All three keep their own measurement.
    for (const word of ["feckless", "reckless", "gormless"]) {
      expect(baseFormSubstitution(word, ON_PRIV), `${word} must not fold`).toBeUndefined();
      expect(score(word, ON_PRIV)).toBe(score(word, BEFORE_PRIV));
    }
  });

  it("keeps the reviewed wrong reading on its own data", () => {
    // "listless" is without `list` in the archaic sense (desire), not without a
    // list, and the strip cannot see the difference -- so a fold exemption
    // refuses it. The blanket entry covers the paradigm: the adverb and the noun
    // fold onto this word and stop, rather than reaching `list` themselves.
    expect(score("listless", ON_PRIV)).toBe(score("listless", BEFORE_PRIV));
    for (const word of ["listlessly", "listlessness", "listlessnesses"]) {
      expect(score(word, ON_PRIV), word).toBe(score("listless", ON_PRIV));
    }
  });

  it("puts back the doubled letter the suffix collapsed", () => {
    // "skilless" is `skill` + -less with one "l" gone, so the plain strip lands
    // on the listed "skil" (1.90) and would out-vote "skill" (4.42). The
    // restored spelling is offered alongside it, and "skillessness" reaches the
    // same base through the adjective.
    expect(score("skilless", ON_PRIV)).toBe(score("skill", ON_PRIV));
    expect(score("skillessness", ON_PRIV)).toBe(score("skill", ON_PRIV));
  });

  it("names the base in the fold note", () => {
    // The note the player sees. Naming `kind` is the whole point of the rule:
    // the score is explained by a word they know.
    expect(baseFormSubstitution("kindless", ON_PRIV)?.base).toBe("kind");
    expect(baseFormSubstitution("pitiless", ON_PRIV)?.base).toBe("pity");
    expect(baseFormSubstitution("kindlessly", ON_PRIV)?.base).toBe("kind");
  });

  it("moves nothing outside the family", () => {
    // The only spelling the rule reads. A word with no "-less" in it cannot
    // reach the new candidates at all.
    for (const word of ["kind", "pity", "body", "faith", "lesson", "lessen", "blessing"]) {
      expect(score(word, ON_PRIV), `${word} must not move`).toBe(score(word, BEFORE_PRIV));
    }
  });
});

// The 2026-09-05 cutover, and the only one so far that takes a fold away: "pre-"
// leaves the transparent prefixes. See PRE_PREFIX_END in dictionary.ts for the
// wrong readings that bought the removal and the right ones it costs.
describe("\"pre-\" stops folding onto the word it was attached to (from 2026-09-05)", () => {
  const BEFORE_PRE = "2026-09-04"; // last day "precooked" scores as `cook`
  const ON_PRE = "2026-09-05"; // first day it is scored on its own data

  const RETIRED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    // The wrong readings the change is for, worst first: each showed a base a
    // player can see and a rank the word had not earned. "pre-" is not a
    // modifier on any of these -- "preapply" is a spelling of "pre-apply" whose
    // residue happens to be the listed "app", "prelife" reached the ordinary
    // "life", and "prefab" is a clipping of "prefabricated" rather than a fab.
    ["preapply", "app", 4.6, 9.92],
    ["prelife", "life", 3.08, 9.93],
    ["prehearing", "hear", 4.06, 8.07],
    ["precaution", "caution", 5.86, 6.39],
    ["predominance", "dominance", 6.06, 7.82],
    ["prefab", "fab", 6.67, 8.11],
    ["premonish", "monished", 9.36, 9.89],
    // And the price, which is the larger half: the transparent readings go with
    // them, and these are folds that were right.
    ["precooked", "cook", 4.9, 8.69],
    ["prearranged", "arranged", 5.38, 8.13],
    ["predawn", "dawn", 5.44, 8.51],
    ["prebade", "bade", 7.65, 10],
  ];

  it.each(RETIRED)("%s no longer scores as %s from the cutover on", (word, _base, _b, after) => {
    expect(score(word, ON_PRE)).toBe(after);
  });

  it.each(RETIRED)("%s scored as %s the day before", (word, base, before) => {
    expect(score(word, BEFORE_PRE)).toBe(before);
    expect(baseFormSubstitution(word, BEFORE_PRE)?.base).toBe(base);
  });

  it("takes the prefix hop away and leaves every other rule standing", () => {
    // What "retired" means here: only the prefix strip is gone. A word that can
    // reach a base without it still does -- "precook" onto its own participle
    // by the reverse fold, "preapply" onto "preapplied" -- so the removal is one
    // hop out of the chain rather than an exemption from folding.
    expect(baseFormSubstitution("precook", ON_PRE)?.base).toBe("precooked");
    expect(baseFormSubstitution("preapply", ON_PRE)?.base).toBe("preapplied");
    expect(score("preboil", ON_PRE)).toBe(score("preboiled", ON_PRE));
  });

  it("raises 4,554 words and lowers none, every one carrying a retired prefix", () => {
    // The counterpart of the demote-only invariants above, and the reason this
    // cutover needs one of its own: taking a fold away is the one change that
    // *can* raise a score, so the guard is not "nothing rose" but "only these
    // families did". A word outside them moving either way means a flag reached
    // further than the prefixes it names.
    //
    // Shared by both of the day's retirements, since they share a date -- the
    // "pre-" half is pinned separately below.
    // Every prefix retired on the date, both halves: "pre-" and the borrowed
    // set. What is left folding is "counter-", "under-", "anti-", "over-",
    // "out-" and "un-".
    const RETIRED = [
      "pre", "pseudo", "quasi", "proto", "trans", "inter", "super", "hyper",
      "multi", "micro", "macro", "ultra", "photo", "semi", "auto", "post",
      "tele", "mono", "poly", "neo", "non", "mis", "sub",
    ];
    const raised: string[] = [];
    const lowered: string[] = [];
    for (const word of dictionaryWords as string[]) {
      const before = score(word, BEFORE_PRE);
      const after = score(word, ON_PRE);
      if (after > before + 1e-9) raised.push(word);
      if (after < before - 1e-9) lowered.push(word);
    }
    expect(lowered).toEqual([]);
    expect(raised.filter((word) => !RETIRED.some((p) => word.startsWith(p)))).toEqual([]);
    // Exact rather than a floor: this is the whole cost of the day, and it
    // should not grow quietly. 2,522 land at Mythic or better and 1,717 at
    // Legend -- see PRE_PREFIX_END and BORROWED_PREFIX_END for the trade.
    expect(raised).toHaveLength(4554);
    expect(raised.filter((word) => word.startsWith("pre"))).toHaveLength(808);
  });

  it("leaves the prefixes that survive the day exactly where they were", () => {
    // The six still folding, and the reviewed entries that ride on them: the
    // floor gate, the residue table and the scoped exemptions are untouched.
    for (const word of [
      "outwill",
      "overpeople",
      "underbakes",
      "counterorders",
      "antisnob",
      "unhoused",
      "ungular",
      "antiphonic",
    ]) {
      expect(score(word, ON_PRE), `${word} must not move`).toBe(score(word, BEFORE_PRE));
    }
  });

  it("moves no word the corpora measure, and none the gate already refused", () => {
    // The words the floor gate was holding never reached the prefix strip, so
    // they cannot notice it going: "preface" and "present" are measured far
    // above MEASURED_FLOOR, and "prelect" was refused by the residue table.
    for (const word of ["preface", "present", "prefer", "prelect", "prepone"]) {
      expect(score(word, ON_PRE), `${word} must not move`).toBe(score(word, BEFORE_PRE));
    }
  });
});

// The other half of the 2026-09-05 cutover, and the larger one: every borrowed
// prefix leaves the transparent list. See BORROWED_PREFIX_END in dictionary.ts
// for the distinction it turns on -- a native prefix takes a free-standing word,
// a borrowed one takes a bound stem as readily, so a residue that is a word can
// be a coincidence.
describe("borrowed prefixes stop folding (from 2026-09-05)", () => {
  const BEFORE_BORROWED = "2026-09-04"; // last day "telephony" scores as `phony`
  const ON_BORROWED = "2026-09-05";

  // The coincidence folds, which are the case for the change: not one of these
  // residues is the word the compound was built on, and no frequency gate can
  // see that, because each residue is an ordinary English word.
  const COINCIDENCES: ReadonlyArray<[word: string, base: string, before: number, after: number]> =
    [
      // "protocol" is measured at Zipf 4.15, far above MEASURED_FLOOR, and
      // folded anyway -- it reaches `cole` through the leak PRE_PREFIX_END
      // records, where a below-floor inflection strips the prefix and the
      // reverse fold carries it back up. Retiring the prefix closes this one by
      // the side door; the leak itself is still there.
      ["protocol", "cole", 5.57, 5.61],
      ["protocols", "cole", 5.57, 5.61],
      ["telephony", "phony", 6.73, 7.36],
      ["monophony", "phony", 6.73, 9.34],
      ["semination", "nation", 4.57, 8.82],
      ["monopodia", "podium", 6.34, 9.82],
      ["polygala", "gala", 6.28, 9.54],
      ["prototrophy", "trophy", 5.58, 9.32],
      ["autotrophy", "trophy", 5.58, 9.2],
      ["pseudoscope", "scope", 5.45, 9.9],
      ["subsister", "sister", 4.47, 9.69],
      ["postface", "face", 3.74, 9.16],
      ["teletext", "text", 4.38, 8.66],
    ];

  // And the price, which is the larger part: where a borrowed prefix does take a
  // free-standing word the fold was right, and it goes with the rest.
  const COST: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    ["semiweekly", "week", 3.57, 9.67],
    ["protohuman", "human", 3.88, 9.69],
    ["telemarketing", "market", 3.97, 7.9],
    ["subdirector", "director", 4.18, 9.29],
    ["supertitles", "title", 4.25, 9.83],
    ["microtones", "tone", 5.13, 9.59],
    ["multitracks", "track", 4.37, 8.65],
    ["interworks", "work", 2.98, 8.27],
    ["neoorthodoxy", "orthodoxy", 6.85, 9.58],
    ["photomaps", "map", 4.74, 9.33],
    ["hypercharge", "charge", 4.37, 9.59],
    ["misdoubt", "doubt", 4.54, 8.61],
  ];

  const RETIRED = [...COINCIDENCES, ...COST];

  it.each(RETIRED)("%s no longer scores as %s from the cutover on", (word, _b, _s, after) => {
    expect(score(word, ON_BORROWED)).toBe(after);
  });

  it.each(RETIRED)("%s scored as %s the day before", (word, base, before) => {
    expect(score(word, BEFORE_BORROWED)).toBe(before);
    expect(baseFormSubstitution(word, BEFORE_BORROWED)?.base).toBe(base);
  });

  it("raises 3,746 words, the larger half of the day", () => {
    // Pinned like the "pre-" count beside it. This is the whole cost of the
    // change and it should not grow quietly.
    const raised = (dictionaryWords as string[]).filter(
      (word) =>
        !word.startsWith("pre") &&
        score(word, ON_BORROWED) > score(word, BEFORE_BORROWED) + 1e-9
    );
    expect(raised).toHaveLength(3746);
  });

  it("leaves no borrowed prefix reaching its residue", () => {
    // One word per retired prefix, and the assertion is on the residue rather
    // than on folding at all: a plural still folds onto its own singular
    // ("multitracks" -> "multitrack"), which is the inflectional rule doing its
    // job. What must be gone is the strip.
    for (const [word, residue] of [
      ["pseudoscope", "scope"],
      ["quasiperiodicity", "periodicity"],
      ["protohuman", "human"],
      ["transvalued", "value"],
      ["interworks", "work"],
      ["supertitles", "title"],
      ["hypercharge", "charge"],
      ["multitracks", "track"],
      ["microtones", "tone"],
      ["macroclimate", "climate"],
      ["ultracentrifuges", "centrifuge"],
      ["photomaps", "map"],
      ["semiweekly", "week"],
      ["autotrophy", "trophy"],
      ["postface", "face"],
      ["telemarketing", "market"],
      ["monopodia", "podium"],
      ["polygala", "gala"],
      ["neoorthodoxy", "orthodoxy"],
      ["nonliving", "live"],
      ["misdoubt", "doubt"],
      ["subdirector", "director"],
    ] as const) {
      expect(baseFormSubstitution(word, BEFORE_BORROWED)?.base, `${word} reached it before`).toBe(
        residue
      );
      expect(
        baseFormSubstitution(word, ON_BORROWED)?.base,
        `${word} must not reach ${residue}`
      ).not.toBe(residue);
    }
  });

  it("leaves the native prefixes folding exactly as they were", () => {
    // The six left in the list, and the reason the rule still exists: a native
    // prefix takes a free-standing English word, so its residue is a word by
    // construction and its folds are right by construction. Nothing on either
    // cutover may touch them.
    //
    // Asserted over the whole dictionary rather than on samples, because "these
    // six are untouched" is the guarantee, not "these six examples are".
    const NATIVE = ["un", "over", "out", "under", "counter", "anti"];
    const moved = (dictionaryWords as string[]).filter(
      (word) =>
        NATIVE.some((prefix) => word.startsWith(prefix)) &&
        score(word, ON_BORROWED) !== score(word, BEFORE_BORROWED)
    );
    expect(moved).toEqual([]);
    // Kept honest: a rule that folded nothing would also pass the line above.
    const folding = (dictionaryWords as string[]).filter(
      (word) =>
        NATIVE.some((prefix) => word.startsWith(prefix)) &&
        baseFormSubstitution(word, ON_BORROWED) !== undefined
    );
    expect(folding.length).toBeGreaterThan(5000);
  });

  it("moves no word the corpora measure, whatever it starts with", () => {
    // The floor gate still holds for everything it ever held: these open with a
    // retired prefix and are measured far above MEASURED_FLOOR, so they never
    // reached the strip and cannot notice it going.
    for (const word of [
      "television",
      "telephone",
      "monopoly",
      "monolith",
      "polyester",
      "semiannual",
      "nonsense",
      "mistake",
      "subject",
      "interest",
      "supermarket",
      "postage",
    ]) {
      expect(score(word, ON_BORROWED), `${word} must not move`).toBe(
        score(word, BEFORE_BORROWED)
      );
    }
  });
});

// The 2026-09-10 cutover: the bare-stem reading of an "-ed"/"-ing" ending is
// dropped where English spells that stem's own forms with a doubled consonant,
// so the silent-"e" reading is the only one left on offer. See
// DOUBLING_TENSE_START in dictionary.ts, and `doublingTenseStem` in stem.ts for
// the spelling rule.
describe("an -ed/-ing ending stops reading as a stem English would double (from 2026-09-10)", () => {
  const BEFORE_DOUBLING = "2026-09-09"; // last day "waning" scores as `wan`
  const ON_DOUBLING = "2026-09-10";

  // word, the base it took before, the base it takes now (undefined where the
  // right base is *rarer* than the word and so caps nothing), and the scores.
  const MOVED: ReadonlyArray<
    [word: string, was: string, now: string | undefined, before: number, after: number]
  > = [
    // The case that motivated it: "wan" conjugates as "wanning", so "waning" was
    // never its participle -- and `wane`, the verb it is one of, is rarer than
    // the form, which is why nothing caps it now.
    ["waning", "wan", undefined, 6.1, 7.14],
    // Its own past tense lands on the gerund instead, through the fold's second
    // direction: the paradigm settles on one number rather than splitting.
    ["waned", "wan", "waning", 6.1, 7.14],
    ["biting", "bit", "bite", 3.86, 5.38],
    ["themed", "them", "theme", 2.63, 4.94],
    ["noted", "not", "note", 1.84, 4.34],
    ["caning", "can", "cane", 2.21, 6.16],
    ["planing", "plan", "plane", 3.97, 4.8],
    ["fated", "fat", "fate", 4.61, 5.31],
    ["scraping", "scrap", "scrape", 5.96, 6.66],
    // The old base need not even be the stem: "coping" reached `cops` through
    // the number rules once the tense rule had put it on `cop`.
    ["coping", "cops", "cope", 5.23, 5.76],
    ["staring", "star", undefined, 4.12, 5.62],
  ];

  it.each(MOVED)("%s stops scoring as %s", (word, _was, now, _before, after) => {
    expect(score(word, ON_DOUBLING)).toBe(after);
    expect(baseFormSubstitution(word, ON_DOUBLING)?.base).toBe(now);
  });

  it.each(MOVED)("%s scored as %s the day before", (word, was, _now, before) => {
    expect(score(word, BEFORE_DOUBLING)).toBe(before);
    expect(baseFormSubstitution(word, BEFORE_DOUBLING)?.base).toBe(was);
  });

  it("never lets a word fold onto a stem its own forms would double", () => {
    // The whole change, stated over the dictionary rather than on the samples
    // above: not one word may take a base that only exists as a doubled
    // spelling. 181 did the day before, which is what keeps this from passing
    // vacuously.
    const words = dictionaryWords as string[];
    const dictionary = new Set(words);
    const blockedStem = (word: string) => {
      const stem = doublingTenseStem(word);
      return stem !== undefined && dictionary.has(`${stem}e`) ? stem : undefined;
    };
    const foldingOnBlocked = (date: string) =>
      words.filter((word) => {
        const stem = blockedStem(word);
        return stem !== undefined && baseFormSubstitution(word, date)?.base === stem;
      });
    expect(foldingOnBlocked(ON_DOUBLING)).toEqual([]);
    expect(foldingOnBlocked(BEFORE_DOUBLING)).toHaveLength(181);
  });

  it("leaves a spelling with no rival reading exactly where it was", () => {
    // The conservatism the rule is paired with (see `blockedTenseStem`): where
    // the silent-"e" reading is not a word, the bare strip is the only base the
    // spelling has, and taking it would promote the word for nothing. "bus" is
    // the honest exception to the doubling rule itself ("busing"/"bussing" are
    // both written); the rest are misspellings and words that are no tense at
    // all, and every one keeps the base it had.
    for (const [word, base] of [
      ["busing", "bus"],
      ["bused", "bus"],
      ["chating", "chat"],
      ["biped", "bip"],
    ] as const) {
      expect(baseFormSubstitution(word, ON_DOUBLING)?.base, `${word} keeps ${base}`).toBe(base);
      expect(score(word, ON_DOUBLING)).toBe(score(word, BEFORE_DOUBLING));
    }
    // And as a class, over the dictionary: 21 words offer a doubling stem with
    // no "-e" word beside it, 12 of them still folding onto it, and not one
    // moves on the cutover.
    const dictionary = new Set(dictionaryWords as string[]);
    const noRival = (dictionaryWords as string[]).filter((word) => {
      const stem = doublingTenseStem(word);
      return stem !== undefined && !dictionary.has(`${stem}e`);
    });
    expect(noRival).toHaveLength(21);
    expect(noRival.filter((word) => baseFormSubstitution(word, ON_DOUBLING))).toHaveLength(12);
    expect(
      noRival.filter((word) => score(word, ON_DOUBLING) !== score(word, BEFORE_DOUBLING))
    ).toEqual([]);
  });

  it("leaves every other tense fold alone", () => {
    // The three shapes the spelling rule must never touch: a stem that is fine
    // as it stands ("wait", "offer"), the doubled spelling itself -- where the
    // bare stem is the *right* answer and reached through the doubled-consonant
    // trim -- and the endings this rule has no opinion about.
    for (const [word, base] of [
      ["waiting", "wait"],
      ["offering", "offer"],
      ["wanning", "wan"],
      ["hopping", "hop"],
      ["tried", "try"],
      ["bathing", "bath"],
    ] as const) {
      expect(baseFormSubstitution(word, ON_DOUBLING)?.base, `${word} -> ${base}`).toBe(base);
      expect(score(word, ON_DOUBLING)).toBe(score(word, BEFORE_DOUBLING));
    }
  });

  it("raises 229 words and lowers 23", () => {
    // Pinned like the counts on the cutovers before it. The rises are the
    // change: a word stops carrying the frequency of a word it is not a form of.
    // They are also the shape the demote-only discipline allows -- a fold
    // pruned, not a score talked up -- so the words reaching the top ranks for
    // it are listed rather than counted.
    const words = dictionaryWords as string[];
    const raised = words.filter(
      (word) => score(word, ON_DOUBLING) > score(word, BEFORE_DOUBLING) + 1e-9
    );
    const lowered = words.filter(
      (word) => score(word, ON_DOUBLING) < score(word, BEFORE_DOUBLING) - 1e-9
    );
    expect(raised).toHaveLength(229);
    // Every one is an obscure verb form whose score was borrowed from an
    // ordinary word ("griding" from `grid`, "skiting" from `skit`, "woning"
    // from `won`), and each new cap is its own verb, itself at the measurement
    // floor. None reaches Legend.
    expect(raised.filter((word) => rank(word, ON_DOUBLING) === "Mythic")).toEqual([
      "cozed",
      "cozing",
      "crined",
      "crining",
      "grided",
      "griding",
      "keping",
      "preved",
      "preving",
      "skited",
      "skiting",
      "woning",
    ]);
    expect(raised.filter((word) => rank(word, ON_DOUBLING) === "Legend")).toEqual([]);
    // The falls are all one thing: the second direction reaching a form it
    // could not reach while the misreading stood, so a verb is now capped at
    // its own participle ("wane" at "waning", "stare" at "staring", "nake" at
    // "naked" -- the `belove`/`beloved` shape `inflectedFormFolds` exists for).
    expect(lowered).toEqual([
      "chare",
      "clepe",
      "cume",
      "dine",
      "dote",
      "dupe",
      "gape",
      "kepe",
      "lase",
      "lave",
      "mete",
      "mire",
      "mope",
      "nake",
      "prate",
      "preve",
      "rase",
      "stare",
      "stope",
      "stripe",
      "stripeless",
      "tare",
      "wane",
    ]);
  });

  it("keeps the wan/wane paradigms apart", () => {
    // The player-facing point. Two verbs share a spelling of the stem and
    // nothing else: `wane` takes "waned"/"waning", `wan` takes
    // "wanned"/"wanning", and each family now scores off its own data.
    for (const word of ["wane", "waned", "waning"]) {
      expect(score(word, ON_DOUBLING), `${word} scores with wane`).toBe(7.14);
    }
    for (const word of ["wan", "wanned", "wanning"]) {
      expect(score(word, ON_DOUBLING), `${word} scores with wan`).toBe(6.1);
    }
  });

  it("agrees with the same-root rule, which moved on the same day", () => {
    // The two rules stay separate -- scoring a word as its base has never been a
    // claim that a puzzle may hold only one of them, and duplicate detection
    // reads `baseForm` and submit.ts's own tier-1 ranking rather than anything
    // here -- but the *spelling* claim is one claim, and both now make it from
    // the same date. `refusedTenseStem` is the shared answer (see
    // SAME_ROOT_DOUBLING_START, and same-root.test.ts for what moved).
    //
    // This test was written the other way round when the fold shipped a day
    // ahead of the identity rule: "waning" scored as `wane` while a puzzle that
    // had taken `wan` still refused it.
    expect(sameRootKey("waning", BEFORE_DOUBLING)).toBe("wan");
    for (const word of ["wane", "waned", "waning"]) {
      expect(sameRootKey(word, ON_DOUBLING), `${word} keys on wane`).toBe("wane");
    }
    // And the words the spelling rule has no opinion about are untouched on both
    // sides, which is what keeps this from being a claim about the whole stemmer.
    for (const word of ["waiting", "offering", "wanning", "hopping", "tried", "busing"]) {
      expect(sameRootKey(word, ON_DOUBLING), `${word} keys as before`).toBe(
        sameRootKey(word, BEFORE_DOUBLING)
      );
    }
  });
});

describe('"counter-" and "anti-" fold off the frequency gate (from 2026-09-27)', () => {
  // The day before is inside the freeform trial, where nothing folds at all, so
  // the "before" comparison is taken from the last ordinary folding puzzle --
  // the system this cutover changes (see UNGATED_PREFIX_START, and
  // `scoringFor`'s note on why the rung sits below the freeform fork).
  const BEFORE_UNGATED = "2026-09-13"; // last folding puzzle before the trial
  const ON_UNGATED = "2026-09-27"; // first puzzle on the switch

  // word, the base it takes now, the score before, the score on/after. Every one
  // is measured above MEASURED_FLOOR, which is the only reason it did not fold
  // already.
  const MOVED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    ["counterattack", "attack", 7.37, 4.26],
    ["countermeasure", "measures", 7.36, 4.87],
    ["counterexample", "example", 8.32, 4.0],
    ["counterclockwise", "clockwise", 7.73, 6.93],
    ["antiviral", "viral", 7.44, 5.71],
    ["antitrust", "trust", 6.7, 4.21],
    ["antiabortion", "abortion", 9.13, 5.48],
    ["anticancer", "cancer", 7.97, 4.5],
    // The two readings that invert rather than modify, and fold anyway: the
    // claim is about which form of a string is the common one, not about what
    // the word denotes. An antifreeze is not a freeze, and scoring it a
    // deep-tail find says something plainly false about the string.
    ["antisocial", "social", 7.03, 3.78],
    ["antifreeze", "freeze", 7.81, 5.67],
  ];

  it.each(MOVED)("%s folds onto %s", (word, base, _before, after) => {
    expect(score(word, ON_UNGATED)).toBe(after);
    expect(baseFormSubstitution(word, ON_UNGATED)?.base).toBe(base);
  });

  it.each(MOVED)("%s kept its own score the day the fold last ran", (word, _base, before) => {
    expect(score(word, BEFORE_UNGATED)).toBe(before);
  });

  // The wrong *bracketings*, which is what a frequency gate never caught either
  // and what fold-exemptions.json is for: the letters are there and the prefix
  // is not. Scoped to the prefix, so the word's ordinary folds still run.
  //
  // The four whose numbers moved when this date also stopped capping a word at
  // a longer form (SHORTER_FORMS_START) were held at their own plurals before:
  // "antibody" at "antibodies", "counterpane" at "counterpanes".
  const EXEMPT: ReadonlyArray<[word: string, unreachable: string, score: number]> = [
    ["antibody", "body", 6.57],
    ["counterpart", "part", 6.24],
    ["antimony", "monies", 7.84],
    ["antiphony", "phony", 9.79],
    ["antipathetic", "pathetic", 9.42],
    ["counterpane", "pane", 9.74],
    ["antidotes", "dot", 6.86],
  ];

  it.each(EXEMPT)("%s never reaches %s", (word, unreachable, expected) => {
    expect(score(word, ON_UNGATED)).toBe(expected);
    expect(baseFormSubstitution(word, ON_UNGATED)?.base).not.toBe(unreachable);
  });

  it("moves 507 words up, every one of them prefixed, alongside the audit's withdrawals", () => {
    // The change stated over the dictionary rather than on the samples above.
    // Two claims: nothing outside the two prefixes moves *for this reason* --
    // this is one family, not a retune -- and every move is a fold, which can
    // only ever make a word more common.
    //
    // Scoped to the two prefixes rather than taken over the whole date. The date
    // carries three changes now -- these prefixes, the restored "pre-" in the
    // describe below, and the corpus lexicon -- so a sweep of the whole day
    // would be a claim about all three. Each states its own slice; the corpus
    // states its own in corpus-lexicon.test.ts.
    //
    // The 2026-09-22 audit shares this date and pulls the other way, so the two
    // are separated by direction before either can be stated -- see
    // `lostAFold`. 507 rather than 510: three of these carry an exemption of
    // their own, and losing that fold outweighs gaining this one.
    const moved = (dictionaryWords as string[]).filter(
      (word) =>
        /^(anti|counter)/.test(word) &&
        rarityFor(word, ON_UNGATED)!.zipf !== rarityFor(word, BEFORE_UNGATED)!.zipf &&
        !lostAFold(word, BEFORE_UNGATED, ON_UNGATED)
    );
    expect(moved).toHaveLength(507);
    for (const word of moved) {
      expect(
        rarityFor(word, ON_UNGATED)!.zipf,
        `${word} is no rarer than it was`
      ).toBeGreaterThan(rarityFor(word, BEFORE_UNGATED)!.zipf);
    }
  });

  it("leaves the other four transparent prefixes behind the gate", () => {
    // The argument for ungating is about how many ordinary words merely open
    // with a prefix's letters, and for these it is a great many. Each of these
    // is measured, so the gate is the only thing between it and a base it was
    // never built on.
    for (const word of ["overtime", "understand", "outrage", "uncle", "unclean"]) {
      expect(score(word, ON_UNGATED), `${word} is unchanged`).toBe(score(word, BEFORE_UNGATED));
    }
    expect(baseFormSubstitution("understand", ON_UNGATED)).toBeUndefined();
    expect(baseFormSubstitution("outrage", ON_UNGATED)).toBeUndefined();
  });

  it("still refuses a prefix the word inside a superlative owns", () => {
    // `hasSuperlativeReading` runs for both prefix families, which is what the
    // shared `addPrefixBases` is for: "uncleanest" is the superlative of
    // "unclean", not un- + "cleanest".
    expect(baseFormSubstitution("uncleanest", ON_UNGATED)?.base).toBe("unclean");
  });
});

describe('"pre-" folds again (from MODE_CHOICE_START)', () => {
  // The day before is inside the freeform trial, where nothing folds at all, so
  // "before" is the last ordinary folding puzzle -- the system this cutover
  // changes, exactly as the describe above takes it.
  const BEFORE_RESTORED = "2026-09-13";
  const ON_RESTORED = MODE_CHOICE_START;

  // What the prefix is for: a productive "pre-" on a free-standing English word.
  const MOVED: ReadonlyArray<[word: string, base: string, before: number, after: number]> = [
    ["prewash", "wash", 9.66, 5.17],
    ["preselect", "selected", 8.12, 4.86],
    ["pregame", "game", 7.3, 3.34],
    ["prereview", "review", 9.92, 4.22],
  ];

  it.each(MOVED)("%s folds onto %s", (word, base, _before, after) => {
    expect(score(word, ON_RESTORED)).toBe(after);
    expect(baseFormSubstitution(word, ON_RESTORED)?.base).toBe(base);
  });

  it.each(MOVED)("%s kept its own score the day before", (word, _base, before) => {
    expect(score(word, BEFORE_RESTORED)).toBe(before);
  });

  // The review the restoration rests on (see PRE_PREFIX_RESTORED). All 400
  // families the prefix reaches were judged; the 50 landing on a base that means
  // something else were sent to one of two files. Where the prefix reading is
  // real and only the residue was wrong, the word is pinned to the base it
  // should have reached -- and because these already folded there, the entry
  // *holds* them against the rule rather than moving them.
  const CORRECTED: ReadonlyArray<[word: string, base: string, unchanged: number]> = [
    ["prepositional", "preposition", 7.73], // not `positional`
    ["premillennial", "millennium", 6.24], // not `millennials`, the generation
    ["preachier", "preachy", 8.05], // not `achy`
    ["preclinically", "preclinical", 7.74], // not `clinic`
    ["prefabs", "prefab", 8.11], // not `fab` -- PRE_PREFIX_END's own example
  ];

  it.each(CORRECTED)("%s is pinned to %s by review", (word, base, unchanged) => {
    expect(baseFormSubstitution(word, ON_RESTORED)?.base).toBe(base);
    expect(score(word, ON_RESTORED)).toBe(unchanged);
  });

  // Where no appropriate base exists, the word gets a prefix-scoped entry in
  // fold-exemptions.json: it refuses the hop, leaves the word's ordinary folds
  // alone, and leaves it on its own measured score. The last three are the
  // readings PRE_PREFIX_END was written about, and the reason it could not keep
  // the prefix without a table like this one.
  //
  // Three carry a second number: they were capped at a longer form the day
  // before ("precaution" at "precautions"), and SHORTER_FORMS_START withdraws
  // that on the same date, so they score as themselves.
  const EXEMPTED: ReadonlyArray<
    [word: string, unreachable: string, before: number, after?: number]
  > = [
    ["prelate", "late", 7.69],
    ["prescience", "science", 8.43],
    ["prepuce", "puce", 8.94],
    ["premiss", "miss", 9.53, 9.65],
    ["precaution", "caution", 6.39, 6.66],
    ["preapply", "app", 9.92, 10],
    ["prehearing", "hear", 8.07],
  ];

  it.each(EXEMPTED)("%s never reaches %s", (word, unreachable, before, after = before) => {
    // The rule offers a base and review refuses it, so the prefix never moves
    // the word across the cutover.
    expect(score(word, BEFORE_RESTORED)).toBe(before);
    expect(score(word, ON_RESTORED)).toBe(after);
    expect(baseFormSubstitution(word, ON_RESTORED)?.base).not.toBe(unreachable);
  });

  it("moves 751 words and lowers no score", () => {
    // Two claims, as at every prefix cutover: the change is one family, and
    // every move is a fold, which can only ever make a word more common. The
    // review pass holds the second -- an entry that corrected a fold could have
    // raised a score, and none does.
    //
    // The 2026-09-22 audit shares this date and pulls the other way -- it
    // withdraws folds, which makes words rarer -- and it reaches eleven "pre-"
    // words. Separated by direction so this ledger still states its own change:
    // 751 either way, once the eleven are counted where they belong.
    const moved = (dictionaryWords as string[])
      .filter((word) => rarityFor(word, ON_RESTORED)!.zipf !== rarityFor(word, BEFORE_RESTORED)!.zipf)
      .filter((word) => word.startsWith("pre")) // the day's other half is above
      .filter((word) => !lostAFold(word, BEFORE_RESTORED, ON_RESTORED));
    expect(moved).toHaveLength(751);
    for (const word of moved) {
      expect(
        rarityFor(word, ON_RESTORED)!.zipf,
        `${word} is no rarer than it was`
      ).toBeGreaterThan(rarityFor(word, BEFORE_RESTORED)!.zipf);
    }
  });

  it('stays behind the frequency gate, unlike "counter-" and "anti-"', () => {
    // The reason it is not in UNGATED_PREFIXES: these are the openings of
    // ordinary measured words, and the gate is all that stands between the rule
    // and a base they were never built on.
    for (const word of ["present", "preface", "pressure", "precise", "premium"]) {
      expect(score(word, ON_RESTORED), `${word} is unchanged`).toBe(score(word, BEFORE_RESTORED));
      expect(baseFormSubstitution(word, ON_RESTORED)).toBeUndefined();
    }
  });

  it('leaves "re-" alone, which was measured alongside it and not shipped', () => {
    // 932 families against "pre-"'s 400, the same rate of wrong readings, and
    // corrections that would not hold above the floor -- see PRE_PREFIX_RESTORED.
    for (const word of ["reexplain", "rematch", "reserve", "remorse", "reschool"]) {
      expect(score(word, ON_RESTORED), `${word} is unchanged`).toBe(score(word, BEFORE_RESTORED));
      expect(baseFormSubstitution(word, ON_RESTORED)?.base).not.toBe(word.slice(2));
    }
  });

  it("is off for every puzzle between PRE_PREFIX_END and the cutover", () => {
    for (const date of [BEFORE_RESTORED, "2026-09-10", "2026-09-06"]) {
      expect(baseFormSubstitution("prewash", date)).toBeUndefined();
    }
    // ...and it folded before that, which is the answer changing twice.
    expect(baseFormSubstitution("prewash", "2026-09-04")?.base).toBe("wash");
  });
});

describe("an \"-s\" form is not inflected again (from 2026-10-04)", () => {
  const BEFORE = "2026-10-03";
  const ON = REINFLECTION_START;

  // word, the base it was scored as, the base it scores as now (undefined: its
  // own frequency), and the two scores.
  const FIXED: ReadonlyArray<
    [word: string, was: string, now: string | undefined, before: number, after: number]
  > = [
    // The two-letter "-es" strip, landing on an "-s" form that folds again.
    ["hearses", "hear", "hearse", 4.06, 7.48],
    ["lapses", "lap", "lapse", 5.57, 6.53],
    ["cleanses", "clean", "cleanse", 4.44, 6.56],
    ["teases", "tea", "tease", 4.78, 6.39],
    ["tenses", "ten", "tense", 4.32, 5.89],
    ["parses", "par", "parse", 5.61, 7.24],
    ["copses", "cops", "copse", 5.23, 8.11],
    ["manses", "man", "manse", 3.19, 7.94],
    ["menses", "men", undefined, 3.65, 8.31],
    // The doubled-consonant trim of "-ed"/"-ing": "finess" -> "fines".
    ["finessed", "fine", undefined, 4.06, 8.53],
    ["finessing", "fine", undefined, 4.06, 8.7],
  ];

  it.each(FIXED)("%s no longer scores as %s", (word, was, now, before, after) => {
    expect(baseFormSubstitution(word, BEFORE)?.base).toBe(was);
    expect(score(word, BEFORE)).toBe(before);
    expect(baseFormSubstitution(word, ON)?.base).toBe(now);
    expect(score(word, ON)).toBe(after);
  });

  it("keeps an \"-s\" stem that is the word's own", () => {
    // The residue ends in "ss", or nothing spells the silent-"e" reading, or
    // the rival is a headword nobody has measured ("yese", "metropolise").
    for (const [word, base] of [
      ["glasses", "glass"],
      ["dressed", "dress"],
      ["buses", "bus"],
      ["churches", "church"],
      ["yeses", "yes"],
      ["metropolises", "metropolis"],
    ] as const) {
      expect(baseFormSubstitution(word, ON)?.base, word).toBe(base);
      expect(score(word, ON), word).toBe(score(word, BEFORE));
    }
  });

  it("leaves Early Modern \"-es\" spellings alone, unlike refusedEsStem would", () => {
    // The reason this is not refusedEsStem on the fold: that rule cut "yeares"
    // and "breakes" off their everyday words. Neither residue ends in "s".
    for (const word of ["yeares", "breakes", "workes"]) {
      if (!rarityFor(word, ON)) continue;
      expect(score(word, ON), word).toBe(score(word, BEFORE));
    }
  });

  it("moves 37 curated words, and lowers only menseless", () => {
    // A rule that removes a reading can only raise the word it reads. The one
    // that falls is a paradigm closing: "menses" now round-trips to "mense"
    // rather than to "men", so "mense", and "menseless" through it, cap at
    // "menses" (2.19) instead of their own 1.53.
    const raised: string[] = [];
    const lowered: string[] = [];
    for (const word of dictionaryWords as string[]) {
      const before = score(word, BEFORE);
      const after = score(word, ON);
      if (after > before) raised.push(word);
      else if (after < before) lowered.push(word);
    }
    expect(raised).toHaveLength(36);
    expect(lowered).toEqual(["menseless"]);
  });

  it("changes nothing in Freeform, which folds nothing", () => {
    asMode("freeform", () => {
      for (const word of ["hearses", "finessed", "lapses"]) {
        expect(score(word, ON), word).toBe(score(word, BEFORE));
      }
    });
  });
});
