import { describe, expect, it } from "vitest";
import {
  baseForm,
  derivedBaseCandidates,
  inflectionalBaseCandidates,
  unmeasuredBaseCandidates,
} from "./stem";

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
    expect(inflectionalBaseCandidates("asphyxiates", true)).toContain(
      "asphyxiate",
    );
  });

  it("offers both -es strips, so the caller can pick whichever is a word", () => {
    expect(inflectionalBaseCandidates("glasses", true)).toEqual(
      expect.arrayContaining(["glasse", "glass"]),
    );
  });

  it("offers the -is base for the Greek and Latin vowel-change plurals", () => {
    expect(inflectionalBaseCandidates("analyses", true)).toContain("analysis");
    expect(inflectionalBaseCandidates("crises", true)).toContain("crisis");
    // Offered on any "-es" word; the caller keeps only dictionary words, and
    // the reviewed override on "theses" outranks every spelling guess.
    expect(inflectionalBaseCandidates("taxes", true)).toContain("taxis");
  });

  it("reaches -ies bases at five letters, where baseForm needs six", () => {
    expect(baseForm("cries")).toBe("cri"); // the -ies rule needs length > 5
    expect(inflectionalBaseCandidates("cries", true)).toContain("cry");
  });

  it("offers an -i base for -ies plurals of words ending in i", () => {
    expect(inflectionalBaseCandidates("taxies", true)).toContain("taxi");
    expect(inflectionalBaseCandidates("alkalies", true)).toContain("alkali");
  });

  it("offers the stem-changing irregular plurals", () => {
    expect(inflectionalBaseCandidates("wolves", true)).toContain("wolf");
    expect(inflectionalBaseCandidates("knives", true)).toContain("knife");
    expect(inflectionalBaseCandidates("matrices", true)).toContain("matrix");
    expect(inflectionalBaseCandidates("apices", true)).toContain("apex");
  });

  it("offers the classical plurals", () => {
    expect(inflectionalBaseCandidates("scapulae", true)).toContain("scapula");
    expect(inflectionalBaseCandidates("radii", true)).toContain("radius");
    expect(inflectionalBaseCandidates("abaci", true)).toContain("abacus");
    expect(inflectionalBaseCandidates("momenta", true)).toContain("momentum");
    // The native "-men" plural needs no Latin guard.
    expect(inflectionalBaseCandidates("chairmen", false)).toContain("chairman");
  });

  it("withholds the Latin readings when the caller's guard says so", () => {
    // The guard (latinPluralsAllowed in dictionary.ts) is the word taking an
    // English plural of its own: "alba"/"albas" is the white garment, not the
    // plural of "album", and "taxi"/"taxis" is not the plural of a "taxus".
    expect(inflectionalBaseCandidates("alba", false)).not.toContain("album");
    expect(inflectionalBaseCandidates("comma", false)).not.toContain("commum");
    expect(inflectionalBaseCandidates("taxi", false)).not.toContain("taxus");
    expect(inflectionalBaseCandidates("brae", false)).not.toContain("bra");
  });

  it("does not offer the -a -> -on plural", () => {
    // The sibling of "-a" -> "-um", and the dirty one: it folds "comma" ->
    // "common", "silica" -> "silicon", "squadra" -> "squadron".
    expect(inflectionalBaseCandidates("comma", true)).not.toContain("common");
    expect(inflectionalBaseCandidates("silica", true)).not.toContain("silicon");
  });

  it("keeps the coincidences in the list rather than choosing between them", () => {
    // "caves" really does look like a "-ves" plural of "cafe". Resolving that is
    // the caller's job (most common base wins), not this function's.
    expect(inflectionalBaseCandidates("caves", true)).toEqual(
      expect.arrayContaining(["cafe", "cave"]),
    );
  });

  it("drops candidates under three letters", () => {
    // Two-letter dictionary entries carry the corpus frequency of every word
    // that contains them, so folding onto one would flatten a real word.
    expect(inflectionalBaseCandidates("axes", true)).not.toContain("ax");
    expect(inflectionalBaseCandidates("ares", true)).not.toContain("ar");
  });

  it("never offers the word itself", () => {
    for (const word of [
      "asphyxiates",
      "cries",
      "wolves",
      "glasses",
      "matrices",
    ]) {
      expect(inflectionalBaseCandidates(word, true)).not.toContain(word);
    }
  });

  it("leaves tense inflections to tenseBaseForm", () => {
    expect(inflectionalBaseCandidates("asphyxiated", true)).toEqual([]);
    expect(inflectionalBaseCandidates("asphyxiating", true)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(inflectionalBaseCandidates("WOLVES", true)).toEqual(
      inflectionalBaseCandidates("wolves", true),
    );
  });
});

describe("unmeasuredBaseCandidates", () => {
  it("offers comparative and superlative bases", () => {
    expect(unmeasuredBaseCandidates("specialest")).toContain("special");
    expect(unmeasuredBaseCandidates("abandoner")).toContain("abandon");
    expect(unmeasuredBaseCandidates("assuager")).toContain("assuage");
  });

  it("offers only the -y rewrite for -ier/-iest", () => {
    // The other i-stem candidates let a junk stem chain somewhere real --
    // "campier" reached "campus" through "campi" and out-voted "campy" -- but
    // the rewrite itself is the rule's bread and butter below the floor:
    // "hurrier" is one who hurries, the "abandoner" shape.
    expect(unmeasuredBaseCandidates("babiest")).toEqual(["baby"]);
    expect(unmeasuredBaseCandidates("chubbier")).toEqual(["chubby"]);
    expect(unmeasuredBaseCandidates("campier")).toEqual(["campy"]);
    expect(unmeasuredBaseCandidates("hurrier")).toEqual(["hurry"]);
  });

  it("undoes a doubled consonant", () => {
    expect(unmeasuredBaseCandidates("slimmest")).toContain("slim");
    expect(unmeasuredBaseCandidates("flattest")).toContain("flat");
  });

  it("leaves the Latin neuter plural to the guarded inflectional rule", () => {
    // "-a" -> "-um" moved to inflectionalBaseCandidates behind the
    // English-plural-of-its-own guard, where it can fold measured words like
    // "aquaria" too instead of waiting below the floor.
    expect(unmeasuredBaseCandidates("asyla")).toEqual([]);
    expect(inflectionalBaseCandidates("asyla", true)).toContain("asylum");
  });

  it("offers the stem a bare -ize/-ise verb was built from", () => {
    expect(unmeasuredBaseCandidates("containerise")).toContain("container");
    expect(unmeasuredBaseCandidates("ghettoise")).toContain("ghetto");
    // The "y" candidate reaches the noun behind the verb.
    expect(unmeasuredBaseCandidates("tautologize")).toContain("tautology");
  });

  it("leaves a tensed -ize/-ise form to fold through its own verb", () => {
    // Stripping the tensed endings here read the -is noun plurals as verb
    // tenses ("whatsises" reached "what") and let a conjugation through a
    // strip its own measured verb was barred from ("womanizes" -> "woman").
    // The tense and number rules already offer the bare verb, so the caller's
    // gate is applied at the verb, once per paradigm.
    expect(unmeasuredBaseCandidates("ghettoising")).toEqual([]);
    expect(unmeasuredBaseCandidates("fractionises")).toEqual([]);
    expect(unmeasuredBaseCandidates("ebonized")).toEqual([]);
    expect(unmeasuredBaseCandidates("whatsises")).toEqual([]);
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
    expect(unmeasuredBaseCandidates("capsize")).toContain("caps");
    expect(unmeasuredBaseCandidates("countable")).toContain("county");
    expect(unmeasuredBaseCandidates("fallible")).toContain("fall");
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(unmeasuredBaseCandidates("BABIEST")).toEqual(
      unmeasuredBaseCandidates("babiest"),
    );
    for (const word of ["specialest", "asyla", "abandoner"]) {
      expect(unmeasuredBaseCandidates(word)).not.toContain(word);
    }
  });
});

describe("derivedBaseCandidates", () => {
  it.each([
    ["catholically", "catholic"],
    ["sedimentologically", "sedimentologic"],
    ["availably", "available"],
    ["susceptibly", "susceptible"],
    ["mythologist", "mythology"],
    ["panicked", "panic"],
    ["trafficking", "traffic"],
    ["bureaux", "bureau"],
  ])("offers %s -> %s", (word, base) => {
    expect(derivedBaseCandidates(word)).toContain(base);
  });

  it("does not read an agent noun as a c -> ck rewrite", () => {
    // "-cker" is left out: the base is at least as likely to be the "-ck" verb,
    // and the rule would fold "blockers" onto "bloc" (see the doc comment).
    expect(derivedBaseCandidates("blockers")).toEqual([]);
    expect(derivedBaseCandidates("panicker")).toEqual([]);
  });

  it("leaves the unbound endings to no rule at all", () => {
    // Every family here has a bound ending. The look-alike endings that are
    // ordinary word-final material get no candidate, so nothing downstream has
    // to gate them: "metal", "topic", "unity", "forward", "spaceship".
    for (const word of [
      "metal",
      "topic",
      "unity",
      "forward",
      "spaceship",
      "listless",
    ]) {
      expect(derivedBaseCandidates(word), `${word} must offer nothing`).toEqual(
        [],
      );
    }
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(derivedBaseCandidates("TOXICALLY")).toEqual(
      derivedBaseCandidates("toxically"),
    );
    for (const word of ["toxically", "availably", "mythologist", "bureaux"]) {
      expect(derivedBaseCandidates(word)).not.toContain(word);
    }
  });
});
