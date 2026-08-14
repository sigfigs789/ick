import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { isValidWord, rarityFor, rarityScore, topRarityScore } from "./dictionary";

const explicitlyCuratedWords = [
  "endling",
  "fenestron",
  // Common words wrongly dropped by the source list's lowercase-only filter.
  "amir",
  "awol",
  "boney",
  "brahman",
  "chateau",
  "corinthian",
  "easter",
  "gorgonzola",
  "nan",
  "olympian",
  "passe",
  "pentecostal",
  "raja",
  "savannah",
  "trojan",
  "victorian",
];
const wiktionaryScienceWords = ["biohacking", "neuropsychopharmacology", "scientometrics"];

describe("isValidWord", () => {
  it("keeps the curated dictionary size intentional", () => {
    // Update this only when deliberately regenerating or editing the word list.
    expect(dictionaryWords).toHaveLength(224_873);
  });

  it("accepts a common real word", () => {
    expect(isValidWord("the")).toBe(true);
  });

  it("accepts one- and two-letter dictionary words", () => {
    expect(isValidWord("a")).toBe(true);
    expect(isValidWord("at")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isValidWord("THE")).toBe(true);
  });

  it("accepts SCOWL words that have no wordfreq estimate", () => {
    expect(isValidWord("curtaining")).toBe(true);
  });

  it("accepts long SCOWL words", () => {
    expect(isValidWord("gastroenterology")).toBe(true);
  });

  it("accepts explicitly curated additions", () => {
    for (const word of explicitlyCuratedWords) {
      expect(isValidWord(word), `${word} should be a valid dictionary input`).toBe(true);
    }
  });

  // These common words only appeared capitalized in the source list, so the
  // lowercase-only filter dropped them; they were re-added via extra-words.txt.
  // Pin their frequency-derived rarity so a future regen can't silently shift
  // them without a deliberate update here.
  const droppedCommonWords: ReadonlyArray<[string, string, number]> = [
    ["amir", "Uncommon", 3.4],
    ["awol", "Rare", 2.7],
    ["boney", "Rare", 2.5],
    ["brahman", "Rare", 2.81],
    ["chateau", "Uncommon", 3.3],
    ["corinthian", "Rare", 2.85],
    ["easter", "Uncommon", 4.12],
    ["gorgonzola", "Extremely Rare", 2.22],
    ["nan", "Uncommon", 3.49],
    ["olympian", "Rare", 3.29],
    ["passe", "Rare", 2.53],
    ["pentecostal", "Rare", 2.86],
    ["raja", "Uncommon", 3.31],
    ["savannah", "Uncommon", 3.62],
    ["trojan", "Uncommon", 3.41],
    ["victorian", "Uncommon", 4.12],
  ];

  it.each(droppedCommonWords)(
    "accepts re-added common word %s with its expected rarity",
    (word, rarity, zipf) => {
      expect(isValidWord(word), `${word} should be a valid dictionary input`).toBe(true);
      expect(rarityFor(word)).toEqual({ rarity, zipf });
    },
  );

  it("accepts scored Wiktionary science terms", () => {
    for (const word of wiktionaryScienceWords) {
      expect(isValidWord(word)).toBe(true);
      expect(rarityFor(word)?.zipf).not.toBe(1.4);
    }
  });

  it("accepts spelling variants from supported English regions", () => {
    expect(isValidWord("color")).toBe(true);
    expect(isValidWord("colour")).toBe(true);
    expect(isValidWord("organize")).toBe(true);
    expect(isValidWord("organise")).toBe(true);
    expect(isValidWord("paycheque")).toBe(true);
    expect(isValidWord("bikkie")).toBe(true);
  });

  it("rejects gibberish", () => {
    expect(isValidWord("zzzzqx")).toBe(false);
  });

  it("rejects blocklisted slurs even though they'd otherwise be common enough", () => {
    expect(isValidWord("nigger")).toBe(false);
  });

  it("rejects blocklisted abbreviations", () => {
    expect(isValidWord("aka")).toBe(false);
  });
});

describe("rarityFor", () => {
  it("returns a rarity and zipf score for a known word", () => {
    const info = rarityFor("the");
    expect(info?.rarity).toBe("Quotidian");
    expect(info?.zipf).toBeGreaterThan(7);
  });

  it("reserves Quotidian for scores below 2.0", () => {
    expect(rarityFor("about")?.rarity).toBe("Quotidian");
    expect(rarityScore(rarityFor("about")!.zipf)).toBeLessThan(2);
    expect(rarityFor("there")?.rarity).toBe("Very Common");
  });

  it("returns undefined for a word not in the dictionary", () => {
    expect(rarityFor("zzzzqx")).toBeUndefined();
  });

  it("rarer words have a lower zipf score than common ones", () => {
    const common = rarityFor("the");
    const rare = rarityFor("aardvark");
    expect(common).toBeDefined();
    expect(rare).toBeDefined();
    expect(rare!.zipf).toBeLessThan(common!.zipf);
  });

  it("caps transparent derived words at their more common base word's score", () => {
    const alert = rarityFor("alert")!;

    expect(rarityFor("alertly")).toEqual(alert);
    expect(rarityFor("alertness")).toEqual(alert);
    expect(rarityFor("curtaining")).toEqual(rarityFor("curtain"));
  });

  it("uses the base word's exact frequency for past and ongoing verb forms", () => {
    expect(rarityFor("played")).toEqual(rarityFor("play"));
    expect(rarityFor("rated")).toEqual(rarityFor("rate"));
    expect(rarityFor("planned")).toEqual(rarityFor("plan"));
    expect(rarityFor("studied")).toEqual(rarityFor("study"));
    expect(rarityFor("making")).toEqual(rarityFor("make"));
    expect(rarityFor("running")).toEqual(rarityFor("run"));
    expect(rarityFor("dying")).toEqual(rarityFor("die"));
  });

  it("awards the 10.0 max and Mythic to a word no corpus attests", () => {
    // "autecism" is absent from every frequency source (and its stem too), so
    // the waterfall gives it the rarest-word sentinel -- the only Zipf that
    // earns a perfect 10.
    const floored = rarityFor("autecism")!;
    expect(floored.rarity).toBe("Mythic");
    expect(rarityScore(floored.zipf)).toBe(10);
  });

  it("awards Mythic only for a rank of 9.5 or higher", () => {
    const belowMythic = rarityFor("assonant")!;
    const mythic = rarityFor("autecism")!;

    expect(rarityScore(belowMythic.zipf)).toBeLessThan(9.5);
    expect(belowMythic.rarity).not.toBe("Mythic");
    expect(rarityScore(mythic.zipf)).toBeGreaterThanOrEqual(9.5);
    expect(mythic.rarity).toBe("Mythic");
  });
});

describe("rarityScore", () => {
  it("flips Zipf's polarity so a higher score means rarer", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;
    expect(rarityScore(rare.zipf)).toBeGreaterThan(rarityScore(common.zipf));
  });

  it("normalizes against the dictionary's Zipf range", () => {
    // "the" is the dictionary's most common word (highest Zipf) -- it anchors
    // the 0.0 score. Only the rarest-word sentinel (words no corpus attests)
    // anchors 10.0; an attested-but-rare word lands just below it.
    const mostCommon = rarityFor("the")!;
    const floored = rarityFor("autecism")!;
    expect(rarityScore(mostCommon.zipf)).toBe(0);
    expect(rarityScore(floored.zipf)).toBe(10);
    expect(rarityScore(2.4)).toBeGreaterThan(rarityScore(3.3));
  });
});

describe("topRarityScore", () => {
  it("returns the highest score from the current puzzle's accepted words", () => {
    const common = rarityFor("the")!;
    const rare = rarityFor("aardvark")!;

    expect(topRarityScore([common, rare])).toBe(rarityScore(rare.zipf));
    expect(topRarityScore([])).toBe(0);
  });
});
