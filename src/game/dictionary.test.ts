import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import {
  CURATED_REJECTION_REASONS,
  baseFormSubstitution,
  bestWordForDrop,
  curatedRejection,
  isValidWord,
  rarityFor,
  rarityForZipf,
  rarityScore,
  topRarityScore,
  isUnattestedZipf,
  unattestedZipf,
} from "./dictionary";
import rarityData from "../data/rarity.json";
import scoreOverrides from "../data/score-overrides.json";
import wordRejections from "../data/word-rejections.json";
import { addDays } from "./date";
import { REJECTION_MESSAGES, evaluateSubmission } from "./submit";

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
  ["aggrandization", "Epic", 1.52],
];
// Rare words discovered online for an upcoming drop and added via the "Add rare
// words found online" GitHub Action (list=online). Appended automatically by
// scripts/manage-extra-word.py record-word.
const onlineWordScores: ReadonlyArray<[string, string, number]> = [
  ["eleatic", "Mythic", 1.17],
  ["payline", "Rare", 2.26],
  ["pembina", "Rare", 2.2],
  ["pomarine", "Epic", 1.45],
  ["portation", "Rare", 2.28],
  ["poussin", "Rare", 2.26],
  ["reassociation", "Epic", 1.49],
  ["sation", "Epic", 1.37],
  ["sideration", "Extremely Rare", 1.92],
];
const wiktionaryScienceWords = ["biohacking", "neuropsychopharmacology", "scientometrics"];

describe("isValidWord", () => {
  it("keeps the curated dictionary size intentional", () => {
    // Update this only when deliberately regenerating or editing the word list.
    expect(dictionaryWords).toHaveLength(225_474);
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
    ["easter", "Common", 4.12],
    ["gorgonzola", "Rare", 2.22],
    ["nan", "Uncommon", 3.49],
    ["olympian", "Uncommon", 3.29],
    ["passe", "Rare", 2.53],
    ["pentecostal", "Rare", 2.86],
    ["raja", "Uncommon", 3.31],
    ["savannah", "Uncommon", 3.62],
    ["trojan", "Uncommon", 3.41],
    ["victorian", "Common", 4.12],
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

  it("rejects a blocklisted spurious entry no corpus attests", () => {
    // Unattested, so it scored a perfect 10.0 / Legend. Blocklisted rather than
    // flagged as a misspelling: there's no correct spelling to point a player at.
    expect(isValidWord("tormentatious")).toBe(false);
  });
});

// Legitimate words that players submitted but the game wrongly rejected, found
// in the rejected-word analytics and re-added via scripts/extra-words.txt. Each
// gets its own case pinning the rarity/Zipf the pipeline assigned it, so a future
// regen can't silently drop or re-score one without a deliberate update here.
describe("curated additions from rejected-word analytics", () => {
  const analyticsAdditions: ReadonlyArray<[string, string, number]> = [
    ["astroturf", "Rare", 2.46],
    ["brobdingnagian", "Epic", 1.55],
    ["stromboli", "Rare", 2.18],
    ["carcinisation", "Legend", -1.57],
    ["carcinization", "Legend", -1.57],
    ["dendrimeric", "Legend", -1.57],
  ];

  it.each(analyticsAdditions)(
    "accepts %s and pins its recorded rarity and Zipf",
    (word, rarity, zipf) => {
      expect(isValidWord(word), `${word} should be a valid dictionary input`).toBe(true);
      expect(rarityFor(word), `${word} should keep its recorded rarity/zipf`).toEqual({
        rarity,
        zipf,
      });
    },
  );
});

describe("rarityFor", () => {
  it("returns a rarity and zipf score for a known word", () => {
    const info = rarityFor("the");
    expect(info?.rarity).toBe("Very Common");
    expect(info?.zipf).toBeGreaterThan(7);
  });

  it("puts everyday words in Very Common, the bottom tier", () => {
    // Quotidian used to sit beneath this and was folded in, so the most common
    // words in the language now share the tier rather than having their own.
    expect(rarityFor("about")?.rarity).toBe("Very Common");
    expect(rarityFor("the")?.rarity).toBe("Very Common");
    expect(rarityFor("river")?.rarity).toBe("Very Common");
    expect(rarityScore(rarityFor("about")!.zipf)).toBeLessThanOrEqual(2.5);
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
    // earns a perfect 10, which lands in the deep-tail Legend rank.
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

describe("chained base forms (from 2026-08-19)", () => {
  const before = "2026-08-18";
  const after = "2026-08-19";

  it("resolves a base through its own base instead of its raw frequency", () => {
    // "materialness" is itself unattested and already scores as "material"
    // (4.95). Reading its *raw* 0.65 is what left the plural at Legend.
    expect(rarityFor("materialness", after)!.zipf).toBeCloseTo(4.95, 5);
    expect(rarityFor("materialnesses", before)!.rarity).toBe("Legend");
    expect(rarityFor("materialnesses", after)!.zipf).toBeCloseTo(4.95, 5);
    expect(rarityFor("materialnesses", after)!.rarity).toBe("Common");
  });

  it("reports the link the score came from, not the one it passed through", () => {
    expect(baseFormSubstitution("materialnesses", before)?.base).toBe("materialness");
    expect(baseFormSubstitution("materialnesses", after)?.base).toBe("material");
  });

  it("caps the tense rule instead of inheriting a rarer base outright", () => {
    // "beloved" is measured at 4.17, but "belove" sits at 1.10. Inheriting
    // outright served an everyday word as a Mythic discovery.
    expect(rarityFor("beloved", before)!.rarity).toBe("Mythic");
    expect(rarityFor("beloved", after)!.zipf).toBeCloseTo(4.17, 5);
    expect(baseFormSubstitution("beloved", after)).toBeUndefined();
  });

  it("still folds a tense form onto a more common base", () => {
    expect(baseFormSubstitution("played", after)?.base).toBe("play");
    expect(rarityFor("rated", after)).toEqual(rarityFor("rate", after));
    expect(rarityFor("making", after)).toEqual(rarityFor("make", after));
  });

  it("counts five-letter -ied forms, which the -ed branch used to swallow", () => {
    // The old guard required six letters, so "tried" fell through to the
    // generic -ed branch and scored as "tri".
    expect(baseFormSubstitution("tried", before)?.base).toBe("tri");
    expect(baseFormSubstitution("tried", after)?.base).toBe("try");
    expect(baseFormSubstitution("cried", after)?.base).toBe("cry");
    expect(baseFormSubstitution("dried", after)?.base).toBe("dry");
  });

  it("never leaves a word rarer than its own measurement", () => {
    // The invariant the cap buys: every fold pulls toward common, so no rule
    // can manufacture a top-tier score out of a rare base.
    const offenders = (dictionaryWords as string[]).filter(
      (word, i) => rarityFor(word, after)!.zipf < rarityData.zipfHundredths[i] / 100 - 1e-9
    );
    expect(offenders).toEqual([]);
  });

  it("leaves puzzles before the cutover untouched", () => {
    for (const word of ["materialnesses", "beloved", "tried"]) {
      expect(rarityFor(word, before)).not.toEqual(rarityFor(word, after));
      expect(rarityFor(word, before)).toEqual(rarityFor(word, "2026-08-16"));
    }
  });

  it("terminates on words that fold onto each other", () => {
    // "axes" -> "axis" -> "axes" is a cycle; the walk must not revisit a word
    // already on its own path.
    for (const word of ["axes", "axis"]) {
      expect(() => rarityFor(word, after)).not.toThrow();
      expect(Number.isFinite(rarityFor(word, after)!.zipf)).toBe(true);
    }
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
      (info) => info !== undefined && !isUnattestedZipf(info.zipf)
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

// Curated demotions for words no corpus attests (src/data/score-overrides.json).
// The file grows a batch per daily audit run, so nothing here pins a word list:
// these are the invariants every entry must satisfy, asserted over whatever the
// file currently holds.
describe("curated base-form score overrides", () => {
  const overrides = Object.entries(
    scoreOverrides as Record<string, { base: string; since: string; reason?: string }>
  );
  const zipfByWord = new Map(dictionaryWords.map((w, i) => [w, rarityData.zipfHundredths[i] / 100]));
  const overridden = new Set(overrides.map(([word]) => word));
  // The wide-band cutover in dictionary.ts. An override taking effect before it
  // would re-score puzzles played under an older system.
  const WIDE_BAND_START = "2026-08-16";

  it("ships at least one override, so the cases below are not vacuous", () => {
    expect(overrides.length).toBeGreaterThan(0);
  });

  it.each(overrides)("%s -> %s is a well-formed, playable pair", (word, { base }) => {
    expect(isValidWord(word), `${word} must be a dictionary word`).toBe(true);
    expect(isValidWord(base), `${base} must be a dictionary word`).toBe(true);
    expect(word).not.toBe(base);
  });

  it.each(overrides)("%s takes effect on a date in the current era", (_word, { since }) => {
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Past puzzles must never re-score, so an override can only start on or after
    // the newest system's cutover.
    expect(since >= WIDE_BAND_START).toBe(true);
  });

  it.each(overrides)("%s is demoted by its base, never promoted", (word, { base }) => {
    // The whole point is capping a derived form at the word it came from. A base
    // rarer than the word would be a promotion, and Math.max would ignore it --
    // so an entry like that is a review mistake, not a no-op worth shipping.
    expect(zipfByWord.get(base)!).toBeGreaterThan(zipfByWord.get(word)!);
  });

  it.each(overrides)("%s folds one level only", (_word, { base }) => {
    // adjustedZipf applies a single override and stops. If a base were itself
    // overridden, the fold would silently stop one step short of the intended
    // score, so chains are rejected outright rather than followed.
    expect(overridden.has(base)).toBe(false);
  });

  it.each(overrides)("%s scores as its base from its start date on", (word, { base, since }) => {
    expect(rarityFor(word, since)).toEqual({
      rarity: rarityForZipf(zipfByWord.get(base)!, since),
      zipf: zipfByWord.get(base)!,
    });
  });

  it.each(overrides)("%s keeps its own, rarer score the day before", (word, { since }) => {
    const before = addDays(since, -1);
    expect(rarityFor(word, before)!.zipf).toBeLessThan(rarityFor(word, since)!.zipf);
  });

  it.each(overrides)("%s reports the substitution for analytics", (word, { base, since }) => {
    expect(baseFormSubstitution(word, since)).toEqual({
      word,
      base,
      ownZipf: zipfByWord.get(word)!,
      baseZipf: zipfByWord.get(base)!,
    });
    // The day before, the *curated* base must not be in force yet. Asserting no
    // substitution at all would be too strong: a word can have a natural fold of
    // its own that the override redirects rather than creates. "convincers" folds
    // to "convincer" (Zipf 1.09, still a Mythic) unaided, and its override sends
    // it the rest of the way to "convince" (4.26) from `since` on.
    expect(baseFormSubstitution(word, addDays(since, -1))?.base).not.toBe(base);
  });
});

// Reviewed rejections (src/data/word-rejections.json). A rejected word stays in
// dictionary.json -- so rarity.json stays index-aligned and past puzzles keep
// scoring it -- but stops being playable from its `since` date. Like the overrides
// above, these cases iterate whatever the file holds rather than pinning a list.
describe("curated word rejections", () => {
  const rejections = Object.entries(
    wordRejections as Record<string, { reason: string; since: string; note?: string }>
  );
  const WIDE_BAND_START = "2026-08-16";

  it("keeps its reason vocabulary renderable by the submit flow", () => {
    // Holds with or without entries in the data file: every reason a rejection is
    // allowed to carry must have a message, or a player would get a blank one.
    for (const reason of CURATED_REJECTION_REASONS) {
      expect(REJECTION_MESSAGES[reason], `${reason} needs a player-facing message`).toBeTruthy();
    }
  });

  it.each(rejections)("%s uses a reason the submit flow can show", (_word, { reason }) => {
    expect(CURATED_REJECTION_REASONS).toContain(reason);
  });

  it.each(rejections)("%s is still in the dictionary, just unplayable", (word, { since }) => {
    // The whole point of rejecting rather than removing: the word list and the
    // index-aligned rarity arrays never move.
    expect(dictionaryWords).toContain(word);
    expect(rarityFor(word, since)).toBeDefined();
    expect(isValidWord(word, since)).toBe(false);
  });

  it.each(rejections)("%s takes effect on a date in the current era", (_word, { since }) => {
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(since >= WIDE_BAND_START).toBe(true);
  });

  it.each(rejections)("%s was playable the day before", (word, { since }) => {
    // An archived puzzle has to keep validating the words it validated when it was
    // played, exactly like the dated score overrides.
    expect(isValidWord(word, addDays(since, -1))).toBe(true);
    expect(curatedRejection(word, addDays(since, -1))).toBeUndefined();
  });

  it.each(rejections)("%s reports its reason to the player", (word, { reason, since }) => {
    // The drop is checked before the word is looked up, so use a substring of the
    // word itself -- otherwise this bounces on "missing-drop" and never reaches
    // the rejection.
    const result = evaluateSubmission(word, word.slice(1, 4), [], since);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
    expect(curatedRejection(word, since)).toBe(reason);
  });

  it("never offers a rejected word as a drop's best possible answer", () => {
    // bestWordForDrop scans dictionary.json directly and its result is shown to
    // the player (DropDisplay), so the rejection has to be honoured there too.
    for (const [word, { since }] of rejections) {
      const best = bestWordForDrop(word.slice(1, 4), since);
      expect(best?.word).not.toBe(word);
    }
  });

  it("leaves words with no entry alone", () => {
    expect(curatedRejection("placate")).toBeUndefined();
    expect(isValidWord("placate")).toBe(true);
    // And a word that was never in the dictionary is still simply invalid.
    expect(isValidWord("zzzzqx")).toBe(false);
  });
});
