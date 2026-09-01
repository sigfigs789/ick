import { describe, expect, it } from "vitest";
import { RARITY_ORDER, baseFormSubstitution, rarityFor, rarityScore } from "./dictionary";
import {
  baseForm,
  inflectedFormCandidates,
  inflectionalBaseCandidates,
  prefixBaseCandidates,
} from "./stem";
import { evaluateSubmission } from "./submit";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
import boundResidueData from "../data/bound-residues.json";
import type { AcceptedWord } from "./types";

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

  it("names only dictionary words, dates every entry, and scopes them legibly", () => {
    const words = new Set(dictionaryWords as string[]);
    for (const [word, entry] of Object.entries(foldExemptionData)) {
      const { since, scope } = entry as { since: string; scope?: string };
      expect(words.has(word), `${word} is not a dictionary word`).toBe(true);
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
      for (const residue of prefixBaseCandidates(word)) {
        expect(residues.has(residue), `${word} could have been a ${residue} table entry`).toBe(
          false
        );
      }
    }
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

  it("keeps its own score when the adjective is rarer", () => {
    // A cap, never a promotion, like every other fold: "furth" (2.10) is rarer
    // than "furthest" (3.17), so the superlative keeps its own measurement.
    expect(score("furthest", ON_SUP)).toBe(score("furthest", BEFORE_SUP));
    expect(score("mopier", ON_SUP)).toBe(score("mopier", BEFORE_SUP));
  });
});
