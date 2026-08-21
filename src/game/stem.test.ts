import { describe, expect, it } from "vitest";
import { baseForm, inflectionalBaseCandidates, unmeasuredBaseCandidates } from "./stem";

describe("baseForm", () => {
  it("strips a simple plural s", () => {
    expect(baseForm("cars")).toBe("car");
  });

  it("does not strip a word ending in double s", () => {
    expect(baseForm("class")).toBe("class");
  });

  it("strips -es", () => {
    expect(baseForm("glasses")).toBe("glass");
  });

  it("strips -ies to y", () => {
    expect(baseForm("puppies")).toBe("puppy");
  });

  it("strips -ing and undoes a doubled consonant", () => {
    expect(baseForm("running")).toBe("run");
  });

  it("strips -ing without a doubled consonant", () => {
    expect(baseForm("hoping")).toBe("hop");
  });

  it("strips -ed and undoes a doubled consonant", () => {
    expect(baseForm("stopped")).toBe("stop");
  });

  it("strips -ied to y", () => {
    expect(baseForm("carried")).toBe("carry");
  });

  it("strips a longer -ying to y", () => {
    expect(baseForm("studying")).toBe("study");
  });

  it("leaves short words alone", () => {
    expect(baseForm("cat")).toBe("cat");
  });

  it("is case-insensitive", () => {
    expect(baseForm("CARS")).toBe(baseForm("cars"));
  });

  it("collapses start and starting to the same root", () => {
    expect(baseForm("starting")).toBe(baseForm("start"));
  });
});

describe("inflectionalBaseCandidates", () => {
  it("offers the one-letter strip that baseForm cannot reach", () => {
    // baseForm commits to stripping both letters of "-es" and lands on the
    // non-word "asphyxiat"; the base is one letter back.
    expect(baseForm("asphyxiates")).toBe("asphyxiat");
    expect(inflectionalBaseCandidates("asphyxiates")).toContain("asphyxiate");
  });

  it("offers both -es strips, so the caller can pick whichever is a word", () => {
    expect(inflectionalBaseCandidates("glasses")).toEqual(
      expect.arrayContaining(["glasse", "glass"])
    );
  });

  it("offers the -is base for the Greek and Latin vowel-change plurals", () => {
    expect(inflectionalBaseCandidates("analyses")).toContain("analysis");
    expect(inflectionalBaseCandidates("crises")).toContain("crisis");
    // Offered on any "-es" word; the caller keeps only dictionary words, and
    // the reviewed override on "theses" outranks every spelling guess.
    expect(inflectionalBaseCandidates("taxes")).toContain("taxis");
  });

  it("reaches -ies bases at five letters, where baseForm needs six", () => {
    expect(baseForm("cries")).toBe("cri"); // the -ies rule needs length > 5
    expect(inflectionalBaseCandidates("cries")).toContain("cry");
  });

  it("offers an -i base for -ies plurals of words ending in i", () => {
    expect(inflectionalBaseCandidates("taxies")).toContain("taxi");
    expect(inflectionalBaseCandidates("alkalies")).toContain("alkali");
  });

  it("offers the stem-changing irregular plurals", () => {
    expect(inflectionalBaseCandidates("wolves")).toContain("wolf");
    expect(inflectionalBaseCandidates("knives")).toContain("knife");
    expect(inflectionalBaseCandidates("matrices")).toContain("matrix");
    expect(inflectionalBaseCandidates("apices")).toContain("apex");
  });

  it("offers the classical plurals", () => {
    expect(inflectionalBaseCandidates("scapulae")).toContain("scapula");
    expect(inflectionalBaseCandidates("radii")).toContain("radius");
    expect(inflectionalBaseCandidates("abaci")).toContain("abacus");
    expect(inflectionalBaseCandidates("chairmen")).toContain("chairman");
  });

  it("does not offer the -a -> -on plural", () => {
    // The sibling of "-a" -> "-um", and the dirty one: it folds "comma" ->
    // "common", "silica" -> "silicon", "squadra" -> "squadron".
    expect(inflectionalBaseCandidates("comma")).not.toContain("common");
    expect(inflectionalBaseCandidates("silica")).not.toContain("silicon");
  });

  it("keeps the coincidences in the list rather than choosing between them", () => {
    // "caves" really does look like a "-ves" plural of "cafe". Resolving that is
    // the caller's job (most common base wins), not this function's.
    expect(inflectionalBaseCandidates("caves")).toEqual(
      expect.arrayContaining(["cafe", "cave"])
    );
  });

  it("drops candidates under three letters", () => {
    // Two-letter dictionary entries carry the corpus frequency of every word
    // that contains them, so folding onto one would flatten a real word.
    expect(inflectionalBaseCandidates("axes")).not.toContain("ax");
    expect(inflectionalBaseCandidates("ares")).not.toContain("ar");
  });

  it("never offers the word itself", () => {
    for (const word of ["asphyxiates", "cries", "wolves", "glasses", "matrices"]) {
      expect(inflectionalBaseCandidates(word)).not.toContain(word);
    }
  });

  it("leaves tense inflections to tenseBaseForm", () => {
    expect(inflectionalBaseCandidates("asphyxiated")).toEqual([]);
    expect(inflectionalBaseCandidates("asphyxiating")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(inflectionalBaseCandidates("WOLVES")).toEqual(inflectionalBaseCandidates("wolves"));
  });
});

describe("unmeasuredBaseCandidates", () => {
  it("offers comparative and superlative bases", () => {
    expect(unmeasuredBaseCandidates("specialest")).toContain("special");
    expect(unmeasuredBaseCandidates("abandoner")).toContain("abandon");
    expect(unmeasuredBaseCandidates("assuager")).toContain("assuage");
  });

  it("restores a y that the -ier/-iest spelling swapped for an i", () => {
    expect(unmeasuredBaseCandidates("babiest")).toContain("baby");
    expect(unmeasuredBaseCandidates("chubbier")).toContain("chubby");
  });

  it("undoes a doubled consonant", () => {
    expect(unmeasuredBaseCandidates("slimmest")).toContain("slim");
    expect(unmeasuredBaseCandidates("flattest")).toContain("flat");
  });

  it("offers the Latin neuter plural base", () => {
    expect(unmeasuredBaseCandidates("asyla")).toContain("asylum");
    expect(unmeasuredBaseCandidates("clitella")).toContain("clitellum");
  });

  it("offers the stem an -ize/-ise verb was built from, tensed or not", () => {
    expect(unmeasuredBaseCandidates("containerise")).toContain("container");
    expect(unmeasuredBaseCandidates("ghettoising")).toContain("ghetto");
    expect(unmeasuredBaseCandidates("fractionises")).toContain("fraction");
    // The "y" candidate reaches the noun behind the verb.
    expect(unmeasuredBaseCandidates("tautologize")).toContain("tautology");
    expect(unmeasuredBaseCandidates("ebonized")).toContain("ebony");
  });

  it("reads a tensed -ize form by its longest ending, not as the bare verb", () => {
    // "-izing" must not be read as "-ize" leaving a stray "in", nor "-izes" as
    // "-ise" leaving a stray "z".
    expect(unmeasuredBaseCandidates("ghettoising")).not.toContain("ghettoin");
    expect(unmeasuredBaseCandidates("fractionises")).not.toContain("fractionz");
  });

  it("offers the stem of an -able/-ible/-ably/-ibly word", () => {
    expect(unmeasuredBaseCandidates("interviewable")).toContain("interview");
    expect(unmeasuredBaseCandidates("requirable")).toContain("require");
    expect(unmeasuredBaseCandidates("preventably")).toContain("prevent");
  });

  it("drops candidates under four letters", () => {
    // Three-letter bases are where the wrong-word folds cluster: without this,
    // "theer" would reach "the" and "noter" would reach "not".
    expect(unmeasuredBaseCandidates("theer")).toEqual([]);
    expect(unmeasuredBaseCandidates("noter")).toEqual([]);
    // It costs a few real three-letter bases too ("bigger" -> "big", "hottest"
    // -> "hot"), which is free: those comparatives are common words, so the
    // caller's frequency gate would have excluded them anyway.
    expect(unmeasuredBaseCandidates("bigger")).not.toContain("big");
  });

  it("still offers the bases that make the gate necessary", () => {
    // This function does not know a word's frequency, so it happily offers a
    // wrong base -- the caller's MEASURED_FLOOR gate is what keeps these from
    // ever being used. Asserted so the gate can't be dropped as redundant.
    expect(unmeasuredBaseCandidates("tempest")).toContain("temp");
    expect(unmeasuredBaseCandidates("shoulder")).toContain("should");
    expect(unmeasuredBaseCandidates("canter")).toContain("cant");
    expect(unmeasuredBaseCandidates("comma")).toContain("commum");
    expect(unmeasuredBaseCandidates("capsize")).toContain("caps");
    expect(unmeasuredBaseCandidates("countable")).toContain("county");
    expect(unmeasuredBaseCandidates("fallible")).toContain("fall");
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(unmeasuredBaseCandidates("BABIEST")).toEqual(unmeasuredBaseCandidates("babiest"));
    for (const word of ["specialest", "asyla", "abandoner"]) {
      expect(unmeasuredBaseCandidates(word)).not.toContain(word);
    }
  });
});
