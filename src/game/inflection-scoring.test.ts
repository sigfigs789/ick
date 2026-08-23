import { describe, expect, it } from "vitest";
import { baseFormSubstitution, rarityFor, rarityScore, scoredAsForm } from "./dictionary";
import { baseForm, inflectionalBaseCandidates } from "./stem";
import { evaluateSubmission } from "./submit";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";
import scoreOverrideData from "../data/score-overrides.json";
import foldExemptionData from "../data/fold-exemptions.json";
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
    // An exemption silences every rule including the override, so a word in
    // both files would have a dead override -- a review error, not a tie.
    const overrides = new Set(Object.keys(scoreOverrideData));
    for (const word of Object.keys(foldExemptionData)) {
      expect(overrides.has(word), `${word} is in both curated files`).toBe(false);
    }
  });

  it("names only dictionary words, and dates every entry", () => {
    const words = new Set(dictionaryWords as string[]);
    for (const [word, entry] of Object.entries(foldExemptionData)) {
      expect(words.has(word), `${word} is not a dictionary word`).toBe(true);
      expect((entry as { since: string }).since >= "2026-08-21").toBe(true);
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
  // (Rare). 1,958 words displayed Mythic or better and are capped by their own
  // "-ed"/"-ing" form once this runs; 24,908 words move in all, 4,944 of them
  // out of Mythic-or-better.
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

describe("what the UI is allowed to say a word was scored as", () => {
  // The fold's false-positive budget was set for a number. A cap may be wrong in
  // the safe direction -- it only ever pulls toward common -- so the chain is
  // allowed to reach a plausible word through a gated spelling guess or a junk
  // intermediate. Printing that as a sentence is a different promise, and the
  // player reads the note exactly where the fold was most aggressive.
  it("names the form when the relation is plain and the score moved", () => {
    const PRINTED: ReadonlyArray<[word: string, named: string]> = [
      ["infatuate", "infatuated"], // the second direction, round-trip confirmed
      ["chances", "chance"], // number inflection
      ["wives", "wife"], // stem-change plural
      ["abaci", "abacus"], // Latin plural, earned above the floor
      ["taxied", "taxi"], // tense
      ["alertly", "alert"], // transparent suffix
      ["absoluteness", "absolute"],
    ];
    for (const [word, named] of PRINTED) {
      expect(scoredAsForm(word), `${word} should name ${named}`).toBe(named);
    }
  });

  it("stays silent where the chain reached its base by a route it cannot claim", () => {
    // Each of these still folds -- the score is unchanged -- and each would have
    // printed something false or unintelligible:
    //   abaser -> "aba", the bare "-er" strip that is only admitted below the
    //     measurement floor *because* the spelling is not decisive
    //   growlier -> "growing", whirlier -> "whirring", bulliest -> "bullying":
    //     chain endpoints two or more hops away, through a junk word
    //   skateable/healable -> "skating"/"healing": the gated "-able" strip
    //   combobulate -> "discombobulated": a reviewed override plus a hop
    for (const word of [
      "abaser",
      "growlier",
      "whirlier",
      "bulliest",
      "skateable",
      "healable",
      "combobulate",
      "reoxygenate",
    ]) {
      expect(scoredAsForm(word), `${word} must not be explained`).toBeUndefined();
      // Silence is about the sentence, not the score: the fold still happened,
      // and analytics still sees it.
      expect(baseFormSubstitution(word)).toBeDefined();
    }
  });

  it("stays silent when the fold barely moved the number", () => {
    // "beet" caps at "beets" three hundredths of a point away. A note that
    // explains nothing is noise on every other row -- half the dictionary folds.
    for (const word of ["beet", "abvolt"]) {
      expect(baseFormSubstitution(word)?.base).toBe(`${word}s`);
      expect(scoredAsForm(word)).toBeUndefined();
    }
  });

  it("says nothing about a word that scored on its own data", () => {
    for (const word of ["enshittification", "fenestron", "singe", "doe"]) {
      expect(scoredAsForm(word)).toBeUndefined();
    }
  });

  it("names only a word displaying the same score, across the whole dictionary", () => {
    // The note has to survive being checked against the next row. A cap takes
    // the raw frequency of the word it caps at, and that word can fold further,
    // which would leave the two rows showing different numbers.
    const inconsistent: string[] = [];
    for (const word of dictionaryWords as string[]) {
      const named = scoredAsForm(word);
      if (!named) continue;
      if (Math.abs(rarityFor(named)!.zipf - rarityFor(word)!.zipf) > 1e-9) {
        inconsistent.push(`${word} -> ${named}`);
      }
    }
    expect(inconsistent).toEqual([]);
  });

  it("prints on a third of the words that fold, not all of them", () => {
    // The gate has to actually gate: half the dictionary folds, and a note on
    // each would be wallpaper rather than information. Pinned as a range so a
    // rule change that quietly doubles the notes shows up here.
    let folds = 0;
    let printed = 0;
    for (const word of dictionaryWords as string[]) {
      if (baseFormSubstitution(word)) folds++;
      if (scoredAsForm(word)) printed++;
    }
    expect(folds).toBeGreaterThan(100_000);
    expect(printed / folds).toBeGreaterThan(0.25);
    expect(printed / folds).toBeLessThan(0.4);
  });

  it("says nothing on a puzzle whose scoring system predates the fold", () => {
    expect(scoredAsForm("infatuate", "2026-08-23")).toBeUndefined();
    expect(scoredAsForm("chances", "2026-08-18")).toBeUndefined();
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
