import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import { baseFormSubstitution, isValidWord, rarityFor, rarityScore, topRarityScore } from "./dictionary";

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
// Words added through the "Add a word" GitHub Action, pinned with the rarity and
// Zipf the data pipeline gave them so the PR shows the word was added *and* how it
// scored. Appended automatically by scripts/manage-extra-word.py record-word.
// [word, rarity, zipf]
const curatedWordScores: ReadonlyArray<[string, string, number]> = [];
const suggestedWordScores: ReadonlyArray<[string, string, number]> = [
  ["aggrandization", "Extremely Rare", 1.52],
];
// Rare words discovered online for an upcoming drop and added via the "Add rare
// words found online" GitHub Action (list=online). Appended automatically by
// scripts/manage-extra-word.py record-word.
const onlineWordScores: ReadonlyArray<[string, string, number]> = [
  ["penquin", "Extremely Rare", 1.79],
];
const wiktionaryScienceWords = ["biohacking", "neuropsychopharmacology", "scientometrics"];

describe("isValidWord", () => {
  it("keeps the curated dictionary size intentional", () => {
    // Update this only when deliberately regenerating or editing the word list.
    expect(dictionaryWords).toHaveLength(225_467);
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

  it("accepts words added via the action with their recorded rarity and score", () => {
    for (const [word, rarity, zipf] of [
      ...curatedWordScores,
      ...suggestedWordScores,
      ...onlineWordScores,
    ]) {
      expect(isValidWord(word), `${word} should be a valid dictionary input`).toBe(true);
      expect(rarityFor(word), `${word} should keep its recorded rarity/zipf`).toEqual({
        rarity,
        zipf,
      });
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

  it("reserves Quotidian for scores at or below 2.0", () => {
    expect(rarityFor("about")?.rarity).toBe("Quotidian");
    expect(rarityScore(rarityFor("about")!.zipf)).toBeLessThanOrEqual(2);
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

  it("caps bound derivational suffixes at their more common base word", () => {
    // -ization/-isation is the noun of an -ize/-ise verb; -ability/-ibility the
    // noun of an -able/-ible adjective. They can't score rarer than that base.
    expect(rarityFor("trivialization")).toEqual(rarityFor("trivialize"));
    expect(rarityFor("readability")).toEqual(rarityFor("readable"));
    expect(rarityFor("acceptability")).toEqual(rarityFor("acceptable"));
  });

  it("never lets the cap make a bound form rarer than its own frequency", () => {
    // "organization" (Zipf 4.92) is more common than "organize" (3.98); the cap
    // only pulls toward a *more* common base, so it keeps its own score.
    expect(rarityFor("organization")).not.toEqual(rarityFor("organize"));
    expect(rarityFor("organization")!.zipf).toBeCloseTo(4.92, 5);
  });

  it("leaves opaque suffixes (-ment, -ism) on their own frequency", () => {
    // "battlement" is not "battle" + ment, nor "arrivism" a form of "arrive";
    // a spelling-only rule can't tell these from real derivations, so they stay.
    expect(rarityFor("battlement")).not.toEqual(rarityFor("battle"));
    expect(rarityFor("battlement")!.zipf).toBeCloseTo(1.77, 5);
    expect(rarityFor("arrivism")).not.toEqual(rarityFor("arrive"));
  });

  it("applies the bound base-form only from the 2026-08-16 wide-band cutover", () => {
    // Before the cutover the derived word keeps its own (rarer) frequency, so
    // past puzzles never shift retroactively.
    const before = "2026-08-15";
    expect(rarityFor("trivialization", before)).not.toEqual(rarityFor("trivialize", before));
    // On/after the cutover -- and for undated (newest) puzzles -- it inherits the base.
    expect(rarityFor("trivialization", "2026-08-16")).toEqual(rarityFor("trivialize", "2026-08-16"));
    expect(rarityFor("trivialization")).toEqual(rarityFor("trivialize"));
  });

  it("awards the 10.0 max and Legend to a word no corpus attests", () => {
    // "autecism" is absent from every frequency source (and its stem too), so
    // the waterfall gives it the rarest-word sentinel -- the only Zipf that
    // earns a perfect 10. The deep tail is its own top rank, Legend.
    const floored = rarityFor("autecism")!;
    expect(floored.rarity).toBe("Legend");
    expect(rarityScore(floored.zipf)).toBe(10);
  });

  it("splits the top of the scale into Legend (deep tail), Mythic, and Extremely Rare", () => {
    const legend = rarityFor("autecism")!; // deep tail, Zipf < 1
    const mythic = rarityFor("aardwolf")!; // Zipf ~1.11, rarest measured slice
    const extremelyRare = rarityFor("assonant")!; // Zipf ~1.53

    // Legend is the deep-tail top rank (score >= the 9.9 ceiling).
    expect(rarityScore(legend.zipf)).toBeGreaterThanOrEqual(9.9);
    expect(legend.rarity).toBe("Legend");

    // Mythic is the rarest measured band, one notch below Legend (~9.5-9.9).
    expect(rarityScore(mythic.zipf)).toBeGreaterThanOrEqual(9.5);
    expect(rarityScore(mythic.zipf)).toBeLessThan(9.9);
    expect(mythic.rarity).toBe("Mythic");

    // Extremely Rare keeps the band beneath Mythic.
    expect(rarityScore(extremelyRare.zipf)).toBeLessThan(9.5);
    expect(extremelyRare.rarity).toBe("Extremely Rare");
  });
});

describe("baseFormSubstitution", () => {
  it("reports the base a bound derivational form inherited", () => {
    const sub = baseFormSubstitution("trivialization");
    expect(sub?.base).toBe("trivialize");
    expect(sub?.word).toBe("trivialization");
    expect(sub?.baseZipf).toBeGreaterThan(sub!.ownZipf);
  });

  it("reports the base verb for a tense form", () => {
    expect(baseFormSubstitution("played")?.base).toBe("play");
  });

  it("returns undefined when a word scores on its own frequency", () => {
    // "organization" is more common than "organize", so no substitution applies.
    expect(baseFormSubstitution("organization")).toBeUndefined();
    expect(baseFormSubstitution("the")).toBeUndefined();
  });

  it("returns undefined before the bound-suffix cutover", () => {
    expect(baseFormSubstitution("trivialization", "2026-08-15")).toBeUndefined();
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
