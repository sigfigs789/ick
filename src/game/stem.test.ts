import { describe, expect, it } from "vitest";
import { baseForm, inflectionalBaseCandidates } from "./stem";

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
