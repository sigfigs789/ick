import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import {
  baseFormSubstitution,
  isValidWord,
  rarityFor,
  rarityForZipf,
  rarityScore,
  topRarityScore,
  isUnattestedZipf,
  unattestedZipf,
} from "./dictionary";
import rarityData from "../data/rarity.json";
import aiTierData from "../data/ai-tiers.json";

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
const curatedWordScores: ReadonlyArray<[string, string, number]> = [
  ["invictus", "Rare", 2.5],
];
const suggestedWordScores: ReadonlyArray<[string, string, number]> = [
  ["aggrandization", "Extremely Rare", 1.52],
];
// Rare words discovered online for an upcoming drop and added via the "Add rare
// words found online" GitHub Action (list=online). Appended automatically by
// scripts/manage-extra-word.py record-word.
const onlineWordScores: ReadonlyArray<[string, string, number]> = [
  ["eleatic", "Mythic", 1.17],
  ["payline", "Extremely Rare", 2.26],
  ["pembina", "Extremely Rare", 2.2],
  ["pomarine", "Extremely Rare", 1.45],
  ["portation", "Extremely Rare", 2.28],
  ["poussin", "Extremely Rare", 2.26],
  ["reassociation", "Extremely Rare", 1.49],
  ["sation", "Extremely Rare", 1.37],
  ["sideration", "Extremely Rare", 1.92],
];
const wiktionaryScienceWords = [
  "biohacking",
  "neuropsychopharmacology",
  "scientometrics",
];

describe("isValidWord", () => {
  it("keeps the curated dictionary size intentional", () => {
    // Update this only when deliberately regenerating or editing the word list.
    expect(dictionaryWords).toHaveLength(225_481);
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
      expect(
        isValidWord(word),
        `${word} should be a valid dictionary input`,
      ).toBe(true);
    }
  });

  it("accepts words added via the action with their recorded rarity and score", () => {
    for (const [word, rarity, zipf] of [
      ...curatedWordScores,
      ...suggestedWordScores,
      ...onlineWordScores,
    ]) {
      expect(
        isValidWord(word),
        `${word} should be a valid dictionary input`,
      ).toBe(true);
      expect(
        rarityFor(word),
        `${word} should keep its recorded rarity/zipf`,
      ).toEqual({
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
      expect(
        isValidWord(word),
        `${word} should be a valid dictionary input`,
      ).toBe(true);
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

// Legitimate words that players submitted but the game wrongly rejected, found
// in the rejected-word analytics and re-added via scripts/extra-words.txt. Each
// gets its own case pinning the rarity/Zipf the pipeline assigned it, so a future
// regen can't silently drop or re-score one without a deliberate update here.
describe("curated additions from rejected-word analytics", () => {
  const analyticsAdditions: ReadonlyArray<[string, string, number]> = [
    ["astroturf", "Extremely Rare", 2.46],
    ["brobdingnagian", "Extremely Rare", 1.55],
    ["stromboli", "Extremely Rare", 2.18],
    ["carcinisation", "Legend", -1.57],
    ["carcinization", "Legend", -1.57],
    // Re-scored by the 2026-08-19 grading cutover: "dendrimeric" is "dendrimer"
    // (Zipf 1.49) plus -ic, so it now reads off that base instead of tying every
    // other unattested word at the top. Its base is measured, so it leaves the
    // sentinel entirely. See src/data/ai-tiers.json.
    ["dendrimeric", "Extremely Rare", 1.49],
  ];

  it.each(analyticsAdditions)(
    "accepts %s and pins its recorded rarity and Zipf",
    (word, rarity, zipf) => {
      expect(
        isValidWord(word),
        `${word} should be a valid dictionary input`,
      ).toBe(true);
      expect(
        rarityFor(word),
        `${word} should keep its recorded rarity/zipf`,
      ).toEqual({
        rarity,
        zipf,
      });
    },
  );
});

describe("rarityFor", () => {
  it("returns a rarity and zipf score for a known word", () => {
    const info = rarityFor("the");
    expect(info?.rarity).toBe("Quotidian");
    expect(info?.zipf).toBeGreaterThan(7);
  });

  it("reserves Quotidian for scores at/below 2.0", () => {
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
    expect(rarityFor("trivialization", before)).not.toEqual(
      rarityFor("trivialize", before),
    );
    // On/after the cutover -- and for undated (newest) puzzles -- it inherits the base.
    expect(rarityFor("trivialization", "2026-08-16")).toEqual(
      rarityFor("trivialize", "2026-08-16"),
    );
    expect(rarityFor("trivialization")).toEqual(rarityFor("trivialize"));
  });

  it("awards the 10.0 max and Legend to a word no corpus attests", () => {
    // "autecism" is absent from every frequency source (and its stem too), so
    // the waterfall gives it the rarest-word sentinel -- the only Zipf that
    // earns a perfect 10, which lands in the deep-tail Legend rank. It keeps
    // that 10 under the grading cutover, which reads it as a headword.
    expect(rarityScore(unattestedZipf())).toBe(10);
    expect(rarityForZipf(unattestedZipf())).toBe("Legend");
    const floored = rarityFor("autecism")!;
    expect(floored.rarity).toBe("Legend");
    expect(rarityScore(floored.zipf)).toBe(10);
  });

  it("awards Legend for a rank of 9.9+ and Mythic for 9.5-9.89", () => {
    const legend = rarityFor("autecism")!;
    expect(rarityScore(legend.zipf)).toBeGreaterThanOrEqual(9.9);
    expect(legend.rarity).toBe("Legend");

    // "aardwolf" is the rarest measured slice -- score in [9.5, 9.9) -> Mythic.
    const mythic = rarityFor("aardwolf")!;
    expect(rarityScore(mythic.zipf)).toBeGreaterThanOrEqual(9.5);
    expect(rarityScore(mythic.zipf)).toBeLessThan(9.9);
    expect(mythic.rarity).toBe("Mythic");
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
    expect(
      baseFormSubstitution("trivialization", "2026-08-15"),
    ).toBeUndefined();
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

describe("unattestedZipf", () => {
  it("is the rarest Zipf in the shipped data -- the no-corpus sentinel", () => {
    // A plain loop, not Math.min(...) -- spreading ~200k elements as call
    // arguments overflows the stack (the same reason dictionary.ts avoids it).
    let minHundredths = Infinity;
    for (const z of rarityData.zipfHundredths) {
      if (z < minHundredths) minHundredths = z;
    }
    const dataMinimum = minHundredths / 100;
    expect(unattestedZipf()).toBe(dataMinimum);
  });

  it("earns the perfect 10 and Legend -- the rarest value we can claim", () => {
    expect(rarityScore(unattestedZipf(), "2026-08-18")).toBe(10);
    expect(rarityForZipf(unattestedZipf(), "2026-08-18")).toBe("Legend");
  });

  it("scores a live word from its own frequency when one is found", () => {
    // A measured Zipf lands in the measured band, well short of the top ranks --
    // so a live lookup that finds real data cannot hand out a Legend by default.
    expect(rarityForZipf(1.54, "2026-08-18")).toBe("Extremely Rare");
    expect(rarityScore(1.54, "2026-08-18")).toBeLessThan(9.5);
    expect(rarityForZipf(4.29, "2026-08-18")).toBe("Common");
  });
});

// Curated words whose shipped rarity entry is the sentinel -- the population
// that scores from a stand-in unless a base form rescues them.
const SENTINEL_WORDS = (() => {
  const words = dictionaryWords as unknown as string[];
  const hundredths = rarityData.zipfHundredths;
  const sentinel = Math.round(unattestedZipf() * 100);
  const out: string[] = [];
  for (let i = 0; i < hundredths.length; i++) {
    if (hundredths[i] === sentinel) out.push(words[i]);
  }
  return out;
})();

describe("isUnattestedZipf", () => {
  it("recognises the sentinel and nothing else", () => {
    expect(isUnattestedZipf(unattestedZipf())).toBe(true);
    expect(isUnattestedZipf(1.54)).toBe(false);
    // Just above the sentinel is real (if barely) measured data.
    expect(isUnattestedZipf(unattestedZipf() + 0.01)).toBe(false);
  });

  it("clears a sentinel word whose score came from a base form", () => {
    // adjustedZipf raises a sentinel word with a more-common base above the
    // sentinel, so its score is derived from data and is not a stand-in. The
    // predicate reads the post-adjustment Zipf, which is what rarityFor returns.
    const rescued = SENTINEL_WORDS.map((word) => rarityFor(word)).find(
      (info) => info !== undefined && !isUnattestedZipf(info.zipf),
    );
    expect(rescued).toBeDefined();
  });

  it("holds across scoring systems, whatever stand-in they substitute", () => {
    // The predicate is on the Zipf, not the score: every system substitutes some
    // artificial value for an unattested word, and they all belong in one bucket.
    expect(isUnattestedZipf(unattestedZipf())).toBe(true);
    expect(rarityScore(unattestedZipf(), "2026-08-18")).toBe(10);
    expect(rarityScore(unattestedZipf(), "2026-08-15")).toBe(10);
  });
});

// The AI-assigned tiers grading the unattested population (src/data/ai-tiers.json,
// generated by scripts/classify-unattested.py). These are judgement calls rather
// than measured frequency, so the tests pin both the file's structural integrity
// and the score guarantees each tier is supposed to buy.
describe("ai-assigned tiers for unattested words", () => {
  const tiers = aiTierData.tiers;
  const inherit = Object.entries(tiers.inherit.words);
  const derived = Object.entries(tiers.derived.words);
  const artifact = Object.entries(tiers.artifact.words);
  const lemma = tiers.lemma.words;
  const inDictionary = new Set(dictionaryWords as unknown as string[]);
  // The last day before grading -- the existing rules alone -- and the first day
  // with it, so the two can be compared word for word.
  const WIDE_BAND = "2026-08-18";
  const GRADED = "2026-08-19";

  it("grades only sentinel words, each once, and never twice", () => {
    const graded = [
      ...inherit.map(([w]) => w),
      ...derived.map(([w]) => w),
      ...artifact.map(([w]) => w),
      ...lemma,
    ];
    expect(new Set(graded).size).toBe(graded.length);
    const sentinel = new Set(SENTINEL_WORDS);
    for (const word of graded) {
      expect(sentinel.has(word), `${word} should be an unattested word`).toBe(
        true,
      );
    }
  });

  it("grades every sentinel word the existing rules cannot already place", () => {
    // The file's whole remit: words with nothing to score from. Anything the
    // tense/inflection/-ness/-ly/bound-suffix rules resolve is already scoring
    // off measured frequency and must be left alone -- so every sentinel word is
    // either resolved by those rules or graded here, and never neither.
    const graded = new Set([
      ...inherit.map(([w]) => w),
      ...derived.map(([w]) => w),
      ...artifact.map(([w]) => w),
      ...lemma,
    ]);
    const orphans = SENTINEL_WORDS.filter(
      (word) =>
        !graded.has(word) && isUnattestedZipf(rarityFor(word, WIDE_BAND)!.zipf),
    );
    expect(orphans).toEqual([]);
  });

  it("only grades real dictionary words, against real dictionary bases", () => {
    for (const [word, base] of [...inherit, ...derived, ...artifact]) {
      expect(
        inDictionary.has(word),
        `${word} should be a dictionary word`,
      ).toBe(true);
      expect(
        inDictionary.has(base),
        `${base} (base of ${word}) should be a dictionary word`,
      ).toBe(true);
      expect(base, `${word} should not be its own base`).not.toBe(word);
    }
    for (const word of lemma) expect(inDictionary.has(word)).toBe(true);
  });

  it("records who assigned the tiers, so the calls stay attributable", () => {
    expect(aiTierData.assignedBy).toBeTruthy();
    expect(aiTierData.assignedOn).toBeTruthy();
    expect(aiTierData.generator).toBe("scripts/classify-unattested.py");
  });

  it("keeps a standalone headword at the perfect 10 and Legend", () => {
    // "kharzy" is unattested because it is genuinely obscure British slang, not
    // because a suffix rule invented it -- exactly the case the perfect 10 is for.
    const kharzy = rarityFor("kharzy")!;
    expect(kharzy.rarity).toBe("Legend");
    expect(rarityScore(kharzy.zipf)).toBe(10);
    // Its 10 is an assigned judgement, not measured data -- the analytics
    // stand-in check has to keep seeing it as such.
    expect(isUnattestedZipf(kharzy.zipf)).toBe(true);
  });

  it("scores an inflection off its base, including the -e singular the stemmer misses", () => {
    // baseForm() strips "es" before "s", so "cabotages" -> "cabotag" (a miss) and
    // the word used to score a perfect 10 despite "cabotage" being measured.
    const cabotages = rarityFor("cabotages")!;
    const cabotage = rarityFor("cabotage")!;
    expect(cabotages.zipf).toBe(cabotage.zipf);
    expect(rarityScore(cabotages.zipf)).toBeLessThan(10);
  });

  it("scores a Commonwealth spelling off its American twin", () => {
    expect(rarityFor("microminiaturise")!.zipf).toBe(
      rarityFor("microminiaturize")!.zipf,
    );
  });

  it("never lets a derivation reach the perfect 10", () => {
    for (const [word] of derived) {
      expect(
        rarityScore(rarityFor(word)!.zipf),
        `${word} should stay under 10`,
      ).toBeLessThanOrEqual(tiers.derived.maxScore);
    }
  });

  it("never lets a suffix-machinery form reach Legend", () => {
    for (const [word] of artifact) {
      const info = rarityFor(word)!;
      expect(
        rarityScore(info.zipf),
        `${word} should stay at or under the artifact cap`,
      ).toBeLessThanOrEqual(tiers.artifact.maxScore);
      expect(info.rarity, `${word} should not be Legend`).not.toBe("Legend");
    }
  });

  it("keeps the comparative of a deep-tail adjective rare, unlike one of a common noun", () => {
    // "quagmirier" inflects "quagmiry" (Zipf -0.23), not "quagmire" (2.75) -- the
    // two bases sit either side of the artifact line, so picking the wrong one
    // flips the tier. "chichier" is the genuine artifact: "chichi" is common.
    expect(rarityFor("quagmirier")!.zipf).toBe(rarityFor("quagmiry")!.zipf);
    expect(rarityScore(rarityFor("chichier")!.zipf)).toBeLessThanOrEqual(
      tiers.artifact.maxScore,
    );
  });

  it("lets measured base forms outrank the assigned tier", () => {
    // "aggrandization" already folds onto "aggrandize" through the bound-suffix
    // rule. The tier file must not override a base the frequency data supports.
    expect(rarityFor("aggrandization")).toEqual(rarityFor("aggrandize"));
  });

  it("leaves puzzles before the cutover untouched", () => {
    // Every unattested word tied at a perfect 10 under the wide-band system.
    for (const word of ["kharzy", "cabotages", "chichier", "dendrimeric"]) {
      expect(
        rarityScore(rarityFor(word, "2026-08-17")!.zipf, "2026-08-17"),
      ).toBe(10);
    }
  });

  it("only ever lowers a score, never raises one", () => {
    // Grading exists to take a word *down* to what its base supports. Finding a
    // base can only cost a word score, never earn it any -- so across the whole
    // dictionary the cutover must produce demotions and nothing else. Checked
    // over every word, since a single promotion means a rule inverted somewhere.
    const words = dictionaryWords as unknown as string[];
    const promoted: string[] = [];
    let demoted = 0;
    for (const word of words) {
      const before = rarityScore(rarityFor(word, WIDE_BAND)!.zipf, WIDE_BAND);
      const after = rarityScore(rarityFor(word, GRADED)!.zipf, GRADED);
      if (after > before) promoted.push(`${word} ${before} -> ${after}`);
      else if (after < before) demoted++;
    }
    expect(promoted).toEqual([]);
    expect(demoted).toBeGreaterThan(0);
  });

  it("keeps the wide-band 10 for a sentinel word the file does not cover", () => {
    // Words accepted live (game/liveValidate.ts) have no tier entry by
    // definition, and grading must not demote them on a guess.
    expect(rarityScore(unattestedZipf(), "2026-08-19")).toBe(10);
  });
});
