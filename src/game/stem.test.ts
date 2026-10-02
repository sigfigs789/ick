import { describe, expect, it } from "vitest";
import {
  baseForm,
  derivedBaseCandidates,
  doublingTenseStem,
  inflectionalBaseCandidates,
  prefixBaseCandidates,
  privativeBaseCandidates,
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
    expect(inflectionalBaseCandidates("asphyxiates", true)).toContain("asphyxiate");
  });

  it("offers both -es strips, so the caller can pick whichever is a word", () => {
    expect(inflectionalBaseCandidates("glasses", true)).toEqual(
      expect.arrayContaining(["glasse", "glass"])
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
      expect.arrayContaining(["cafe", "cave"])
    );
  });

  it("drops candidates under three letters", () => {
    // Two-letter dictionary entries carry the corpus frequency of every word
    // that contains them, so folding onto one would flatten a real word.
    expect(inflectionalBaseCandidates("axes", true)).not.toContain("ax");
    expect(inflectionalBaseCandidates("ares", true)).not.toContain("ar");
  });

  it("never offers the word itself", () => {
    for (const word of ["asphyxiates", "cries", "wolves", "glasses", "matrices"]) {
      expect(inflectionalBaseCandidates(word, true)).not.toContain(word);
    }
  });

  it("leaves tense inflections to tenseBaseForm", () => {
    expect(inflectionalBaseCandidates("asphyxiated", true)).toEqual([]);
    expect(inflectionalBaseCandidates("asphyxiating", true)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(inflectionalBaseCandidates("WOLVES", true)).toEqual(
      inflectionalBaseCandidates("wolves", true)
    );
  });
});

describe("doublingTenseStem", () => {
  it("names the stem a doubled spelling would have to carry the ending", () => {
    // "wan" conjugates as "wanning", so "waning" is not one of its forms.
    expect(doublingTenseStem("waning")).toBe("wan");
    expect(doublingTenseStem("waned")).toBe("wan");
    expect(doublingTenseStem("biting")).toBe("bit");
    expect(doublingTenseStem("themed")).toBe("them");
  });

  it("says nothing about a stem that takes the ending as it stands", () => {
    // Two vowel letters make the syllable long, so nothing doubles.
    for (const word of ["waiting", "heating", "seeding", "roaming"]) {
      expect(doublingTenseStem(word), word).toBeUndefined();
    }
    // Unstressed final syllables take the ending bare, which is why the rule
    // asks for a monosyllable.
    for (const word of ["offering", "riveting", "traveling", "gathered"]) {
      expect(doublingTenseStem(word), word).toBeUndefined();
    }
    // The consonants that never double.
    for (const word of ["blahing", "bowing", "boxing", "shahed"]) {
      expect(doublingTenseStem(word), word).toBeUndefined();
    }
  });

  it("leaves the doubled spelling itself alone", () => {
    // Where the doubling is actually written the bare stem is the *right*
    // reading, reached through stripDoubledConsonant.
    for (const word of ["wanning", "hopping", "batted", "runs"]) {
      expect(doublingTenseStem(word), word).toBeUndefined();
    }
  });

  it("takes no interest in an ending that is not a tense", () => {
    for (const word of ["tried", "dying", "wanes", "wan", "bed"]) {
      expect(doublingTenseStem(word), word).toBeUndefined();
    }
  });

  it("is case-insensitive", () => {
    expect(doublingTenseStem("WANING")).toBe("wan");
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
    expect(unmeasuredBaseCandidates("BABIEST")).toEqual(unmeasuredBaseCandidates("babiest"));
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
    for (const word of ["metal", "topic", "unity", "forward", "spaceship", "listless"]) {
      expect(derivedBaseCandidates(word), `${word} must offer nothing`).toEqual([]);
    }
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(derivedBaseCandidates("TOXICALLY")).toEqual(derivedBaseCandidates("toxically"));
    for (const word of ["toxically", "availably", "mythologist", "bureaux"]) {
      expect(derivedBaseCandidates(word)).not.toContain(word);
    }
  });
});

describe("derivedBaseCandidates length bounds", () => {
  it.each([
    ["epically", "epic"],
    ["stably", "stable"],
    ["viably", "viable"],
    ["oologist", "oology"],
    ["ologist", "ology"],
    ["beaux", "beau"],
  ])("reaches the shortest member of its family: %s -> %s", (word, base) => {
    // Each bound is the shortest word the family actually has. Set one letter
    // higher -- the round numbers this started with -- and every word here is
    // silently dropped.
    expect(derivedBaseCandidates(word)).toContain(base);
  });

  it("offers both spellings for a c -> ck rewrite", () => {
    // "chocked" is a tense of "chock", not of "choc". Offering only the "-c"
    // form hands it "choc"; offering both lets the caller's most-common check
    // pick the real base.
    expect(derivedBaseCandidates("chocked")).toEqual(["choc", "chock"]);
    expect(derivedBaseCandidates("panicked")).toEqual(["panic", "panick"]);
  });
});

describe("privativeBaseCandidates", () => {
  it.each([
    ["kindless", "kind"],
    ["endless", "end"],
    ["bottomless", "bottom"],
    ["pitiless", "pity"],
    ["merciless", "mercy"],
    ["penniless", "penny"],
    ["remediless", "remedy"],
  ])("offers %s -> %s", (word, base) => {
    expect(privativeBaseCandidates(word)).toContain(base);
  });

  it("puts back the doubled l the suffix collapsed", () => {
    // "skilless" is `skill` + -less with one "l" gone. The plain strip is
    // offered too -- the caller keeps the most common -- but "skil" is a listed
    // word, so without the restored spelling it would win.
    expect(privativeBaseCandidates("skilless")).toEqual(["skil", "skill"]);
    // A stem that ends in a single "l" of its own offers a non-word, which the
    // caller's dictionary check drops.
    expect(privativeBaseCandidates("toolless")).toEqual(["tool", "tooll"]);
  });

  it("leaves the -lessly / -lessness derivatives to the -ly and -ness strips", () => {
    // They reach the adjective through `scoringBaseForm` and fold onward from
    // there, so a rule here would be redundant -- and one reaching past the
    // adjective would route around the reviewed exemption that refuses this
    // family's wrong readings. See the doc comment.
    expect(privativeBaseCandidates("kindlessly")).toEqual([]);
    expect(privativeBaseCandidates("kindlessness")).toEqual([]);
  });

  it("reads nothing shorter than a three-letter stem", () => {
    // Seven letters minimum, so a word whose strip would leave a fragment never
    // offers one: "bless" -> "b", "unless" -> "un", and "less" itself.
    for (const word of ["bless", "unless", "less"]) {
      expect(privativeBaseCandidates(word), `${word} must offer nothing`).toEqual([]);
    }
  });

  it("offers the residues no dictionary attests, and nothing more", () => {
    // The rest of the non-derived family. The candidates exist but are not
    // words, so the caller's check refuses them -- no rule of their own needed.
    expect(privativeBaseCandidates("nevertheless")).toEqual(["neverthe"]);
    expect(privativeBaseCandidates("natheless")).toEqual(["nathe"]);
    expect(privativeBaseCandidates("irregardless")).toEqual(["irregard"]);
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(privativeBaseCandidates("KINDLESS")).toEqual(privativeBaseCandidates("kindless"));
    for (const word of ["kindless", "kindlessly", "pitiless"]) {
      expect(privativeBaseCandidates(word)).not.toContain(word);
    }
  });
});

describe("prefixBaseCandidates", () => {
  // The two sides of the 2026-09-05 retirements: LATEST is the live list,
  // ARCHIVED the one the puzzles from 2026-08-24 to 2026-09-04 folded with.
  const LATEST = { pre: false, borrowed: false, de: false };
  const ARCHIVED = { pre: true, borrowed: true, de: false };

  it("offers the base a transparent prefix was attached to", () => {
    expect(prefixBaseCandidates("overplanned", LATEST)).toContain("planned");
    expect(prefixBaseCandidates("outswear", LATEST)).toContain("swear");
    expect(prefixBaseCandidates("unhoused", LATEST)).toContain("housed");
    expect(prefixBaseCandidates("counterordered", LATEST)).toContain("ordered");
    expect(prefixBaseCandidates("antisnob", LATEST)).toContain("snob");
    // The borrowed prefixes are out of the live list and only the archived
    // systems still offer them -- see RETIRED_PREFIXES.
    expect(prefixBaseCandidates("nonplaying", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("misthink", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("nonplaying", ARCHIVED)).toContain("playing");
    expect(prefixBaseCandidates("misthink", ARCHIVED)).toContain("think");
  });

  it("prefers the longest prefix that matches", () => {
    // "under-" against "un-" is the only overlapping pair in the list, so it is
    // the only case that can pin the ordering: both match "underbakes", and the
    // longer one is the intended reading. Asserting on a word where a single
    // prefix matches would pass whatever order the list is in.
    expect(prefixBaseCandidates("underbakes", LATEST)).toEqual(["bakes", "derbakes"]);
    expect(prefixBaseCandidates("undercooked", LATEST)[0]).toBe("cooked");
  });

  it("leaves out the prefixes English fossilised onto Latin stems", () => {
    // "de-", "re-", "co-" and "dis-" are the most productive prefixes there
    // are, and excluded anyway: nothing in the spelling separates a real
    // derivation from a borrowing that merely opens the same way, and the
    // frequency gate cannot help because the fossilised words are rare.
    expect(prefixBaseCandidates("delates", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("refelled", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("coshes", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("disparts", LATEST)).toEqual([]);
    // The cost is real -- these are correct readings the rule gives up on.
    expect(prefixBaseCandidates("codriver", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("reexplain", LATEST)).toEqual([]);
  });

  it("strips \"de-\" from 2026-10-04 and not before", () => {
    // The first of the four fossilised prefixes let in, behind a reviewed table
    // of every strip it reaches. See DE_PREFIX_START.
    const DE = { ...LATEST, de: true };
    expect(prefixBaseCandidates("dechunked", DE)).toEqual(["chunked"]);
    expect(prefixBaseCandidates("dechunked", LATEST)).toEqual([]);
    // The strip is spelling only; "delates" reaching `lates` is refused by a
    // prefix-scoped fold exemption, not here.
    expect(prefixBaseCandidates("delates", DE)).toEqual(["lates"]);
    // The four-letter residue floor still holds.
    expect(prefixBaseCandidates("decal", DE)).toEqual([]);
    // "de-" and "un-" never both match, so the order cannot matter between them.
    expect(prefixBaseCandidates("undechunked", DE)).toEqual(["dechunked"]);
  });

  it("leaves out \"pre-\" too, for the puzzles that come after it", () => {
    // Retired on 2026-09-05 for the same reason the four above never joined:
    // English fossilised it onto stems that were never English words, and the
    // wrong readings ("precaution" as a caution, "prefab" as a fab) cannot be
    // told from the transparent ones by spelling. See PRE_PREFIX_END.
    expect(prefixBaseCandidates("precaution", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("prefabbed", LATEST)).toEqual([]);
    // Correct readings given up along with them, as with "codriver" above.
    expect(prefixBaseCandidates("precooked", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("prearranged", LATEST)).toEqual([]);
  });

  it("still strips \"pre-\" for an archived puzzle that folded it", () => {
    // The flag exists for the 2026-08-24..2026-09-04 puzzles alone, whose scores
    // are frozen where they were played.
    expect(prefixBaseCandidates("precooked", ARCHIVED)).toEqual(["cooked"]);
    expect(prefixBaseCandidates("precaution", ARCHIVED)).toEqual(["caution"]);
    // The flag turns one prefix on and nothing else.
    expect(prefixBaseCandidates("undercooked", ARCHIVED)).toEqual(
      prefixBaseCandidates("undercooked", LATEST)
    );
  });

  it("drops residues under four letters", () => {
    // Where the wrong-word folds cluster: "unit" -> "it", "union" -> "ion",
    // "overt" -> "t", "outer" -> "er".
    expect(prefixBaseCandidates("unit", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("union", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("overt", LATEST)).toEqual([]);
    expect(prefixBaseCandidates("outer", LATEST)).toEqual([]);
  });

  it("still offers the bases that make the gate necessary", () => {
    // Like unmeasuredBaseCandidates, this function cannot see a frequency, so
    // it offers plainly wrong bases for ordinary words. Every one of these is
    // measured far above MEASURED_FLOOR, and the caller's gate is the only
    // thing keeping them out. Asserted so the gate can't be dropped.
    expect(prefixBaseCandidates("outrage", LATEST)).toContain("rage");
    expect(prefixBaseCandidates("understand", LATEST)).toContain("stand");
    expect(prefixBaseCandidates("anticked", LATEST)).toContain("cked");
    // The ones the retired prefixes contributed, which the archived systems
    // still hand the caller.
    expect(prefixBaseCandidates("mistake", ARCHIVED)).toContain("take");
    expect(prefixBaseCandidates("supermarket", ARCHIVED)).toContain("market");
    expect(prefixBaseCandidates("preface", ARCHIVED)).toContain("face");
    expect(prefixBaseCandidates("present", ARCHIVED)).toContain("sent");
  });

  it("is case-insensitive and never offers the word itself", () => {
    expect(prefixBaseCandidates("NONPLAYING", LATEST)).toEqual(
      prefixBaseCandidates("nonplaying", LATEST)
    );
    for (const word of ["nonplaying", "overplanned", "misthink"]) {
      expect(prefixBaseCandidates(word, LATEST)).not.toContain(word);
    }
  });
});
