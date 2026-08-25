import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import {
  CURATED_REJECTION_REASONS,
  RARITY_ORDER,
  BASE_FORM_NOTICE_DROP,
  baseFormRankDrop,
  baseFormSubstitution,
  bestWordForDrop,
  curatedRejection,
  isValidWord,
  rarityFor,
  formatRarityScore,
  rarityForZipf,
  rarityScore,
  topRarityScore,
  isUnattestedZipf,
  unattestedZipf,
} from "./dictionary";
import rarityData from "../data/rarity.json";
import scoreOverrides from "../data/score-overrides.json";
import wordRejections from "../data/word-rejections.json";
import derivedRejections from "../data/derived-rejections.json";
import exemptionsFile from "../../scripts/playable-exemptions.txt?raw";
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
  // Recorded as Elusive 1.52 (the score of its base "aggrandize"). From the
  // 2026-08-24 cutover the fold also runs toward a word's own inflections, and
  // the paradigm's most common member is "aggrandizing" (2.05), which the whole
  // family now caps at -- so the recorded row moves with it.
  ["aggrandization", "Extremely Rare", 2.05],
  ["caprylate", "Mythic", 1.1],
  // Recorded as Mythic 1.25, the score of the base its override pins it to
  // ("discombobulate"). From 2026-08-24 that base is itself capped at its own
  // most common inflection, "discombobulated" (2.07), and the override's word
  // follows it down the chain.
  ["combobulate", "Extremely Rare", 2.07],
  ["conization", "Extremely Rare", 1.8],
  ["inosinate", "Legend", 0.79],
  // Recorded as Extremely Rare 1.88; capped at "reoxygenated" (2.55) from
  // 2026-08-24, the same second-direction fold as the two rows above.
  ["reoxygenate", "Rare", 2.55],
  // Recorded at its base "skate" (3.74); "skating" (3.84) is the paradigm's most
  // common member from 2026-08-24. Same tier, a tenth of a Zipf apart.
  ["skateable", "Uncommon", 3.84],
  ["uridylate", "Legend", 0.68],
];
// Rare words discovered online for an upcoming drop and added via the "Add rare
// words found online" GitHub Action (list=online). Appended automatically by
// scripts/manage-extra-word.py record-word.
const onlineWordScores: ReadonlyArray<[string, string, number]> = [
  ["eleatic", "Mythic", 1.17],
  ["payline", "Rare", 2.26],
  ["pembina", "Rare", 2.2],
  ["portation", "Rare", 2.28],
  ["poussin", "Rare", 2.26],
  ["reassociation", "Elusive", 1.49],
  ["sation", "Elusive", 1.37],
];
// Added by the same action, then caught by the derived rejections that came later:
// Wiktionary marks every sense of these out of use. They keep their slots and
// their scores -- puzzles that accepted them still add up -- but can't be played.
const onlineWordScoresRejected: ReadonlyArray<[string, string, number]> = [
  ["pomarine", "Elusive", 1.45],
  ["sideration", "Extremely Rare", 1.92],
];
const wiktionaryScienceWords = ["biohacking", "neuropsychopharmacology", "scientometrics"];

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

  it("keeps scoring an added word the obsolete rule later rejected", () => {
    for (const [word, rarity, zipf] of onlineWordScoresRejected) {
      expect(isValidWord(word), `${word} is obsolete and unplayable`).toBe(false);
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
    ["brobdingnagian", "Elusive", 1.55],
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
    expect(rarityFor("arrivism")).not.toEqual(rarityFor("arrive"));
    // Its own frequency is 1.77. What it displays from the 2026-08-24 cutover is
    // its *plural's* (2.54): "battlements" is the form anyone writes, and the
    // fold now runs that way too. Still nowhere near "battle" (4.94), which is
    // what this test is about -- the -ment suffix is not stripped.
    expect(rarityFor("battlement")!.zipf).toBeCloseTo(2.54, 5);
    expect(rarityFor("battlement", "2026-08-23")!.zipf).toBeCloseTo(1.77, 5);
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

describe("baseFormRankDrop", () => {
  it("names the base when the fold cost the word a rank", () => {
    // "materialnesses" is unmeasured, so on its own data it would be a Legend;
    // scoring it as "material" makes it Very Common, which is the badge that
    // reads as a bug without an explanation.
    const note = baseFormRankDrop("materialnesses");
    expect(note?.base).toBe("material");
    expect(rarityForZipf(note!.ownZipf)).toBe("Legend");
    expect(rarityForZipf(note!.baseZipf)).toBe("Very Common");
  });

  it("holds its fire when the badge moved but the number barely did", () => {
    // The Legend cutoff is 9.9 and Mythic runs to 9.89, so a fold across that
    // line alone can be a one-cent move -- a note about a score the player
    // cannot see change.
    const shown = (zipf: number) => Number(formatRarityScore(zipf));
    for (const word of dictionaryWords as string[]) {
      const sub = baseFormSubstitution(word);
      if (!sub) continue;
      if (baseFormRankDrop(word)) continue;
      if (rarityForZipf(sub.ownZipf) === rarityForZipf(sub.baseZipf)) continue;
      // Everything left changed rank and was suppressed -- so it must have been
      // the floor that did it.
      expect(shown(sub.ownZipf) - shown(sub.baseZipf)).toBeLessThan(
        BASE_FORM_NOTICE_DROP
      );
    }
  });

  it("fires in the compressed top of the scale, where a small drop is a real one", () => {
    // "abaci" gives up only 2.15 points to "abacus", but it crosses out of
    // Mythic -- the band a fixed point-gap either misses or fires on constantly.
    const note = baseFormRankDrop("abaci");
    expect(note?.base).toBe("abacus");
    expect(rarityForZipf(note!.ownZipf)).toBe("Mythic");
    expect(rarityForZipf(note!.baseZipf)).not.toBe("Mythic");
  });

  it("stays quiet when the fold left the word in the same rank", () => {
    // Both fold; neither changes the badge, so there is nothing to explain.
    expect(baseFormSubstitution("played")?.base).toBe("play");
    expect(baseFormRankDrop("played")).toBeUndefined();
    expect(baseFormRankDrop("trivialization")).toBeUndefined();
  });

  it("stays quiet when the word scored on its own frequency", () => {
    expect(baseFormRankDrop("organization")).toBeUndefined();
    expect(baseFormRankDrop("the")).toBeUndefined();
    expect(baseFormRankDrop("notaword")).toBeUndefined();
  });

  it("follows the date's system, like the substitution it reports", () => {
    // Before the bound-suffix cutover nothing folds, so nothing to report.
    expect(baseFormRankDrop("trivialization", "2026-08-15")).toBeUndefined();
  });

  it("only ever reports a drop, never a word that gained a rank", () => {
    for (const word of dictionaryWords as string[]) {
      const note = baseFormRankDrop(word);
      if (!note) continue;
      expect(RARITY_ORDER.indexOf(rarityForZipf(note.baseZipf))).toBeGreaterThan(
        RARITY_ORDER.indexOf(rarityForZipf(note.ownZipf))
      );
    }
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

  it.each(overrides)("%s -> %s is a well-formed, scoreable pair", (word, { base }) => {
    // Membership, not playability: an override is scoring only, and a base can be
    // a word the derived rejections keep out of play ("computerese" is dated,
    // "continueth" archaic) while still being the frequency the word scores at.
    expect(rarityFor(word), `${word} must be a dictionary word`).toBeDefined();
    expect(rarityFor(base), `${base} must be a dictionary word`).toBeDefined();
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

// Reviewed rejections (src/data/word-rejections.json). Two kinds share the file,
// told apart by whether the word is on the curated list:
//   - a *retired* word stays in dictionary.json -- so rarity.json stays
//     index-aligned and past puzzles keep scoring it -- but stops being playable
//     from its `since` date;
//   - a *reviewed non-word* was never on the curated list, so nothing about play
//     changes; the entry records the verdict and names the fault, which is what
//     turns the generic "not in the curated list" message into "looks like a
//     misspelling" and spares the live Merriam-Webster lookup a word already judged.
// Like the overrides above, these cases iterate whatever the file holds rather
// than pinning a list.
describe("curated word rejections", () => {
  const rejections = Object.entries(
    wordRejections as Record<string, { reason: string; since: string; note?: string }>
  );
  const curatedWords = new Set(dictionaryWords);
  const retired = rejections.filter(([word]) => curatedWords.has(word));
  const reviewedNonWords = rejections.filter(([word]) => !curatedWords.has(word));
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

  it.each(retired)("%s is still in the dictionary, just unplayable", (word, { since }) => {
    // The whole point of rejecting rather than removing: the word list and the
    // index-aligned rarity arrays never move.
    expect(dictionaryWords).toContain(word);
    expect(rarityFor(word, since)).toBeDefined();
    expect(isValidWord(word, since)).toBe(false);
  });

  it("keeps reviewed non-words off the curated list, on every date", () => {
    // A word that never made the list has no `since` boundary to respect: there is
    // no archived puzzle that accepted it, so it is unplayable before and after.
    for (const [word, { since }] of reviewedNonWords) {
      expect(rarityFor(word, since)).toBeUndefined();
      expect(isValidWord(word, since)).toBe(false);
      expect(isValidWord(word, addDays(since, -1))).toBe(false);
    }
  });

  it.each(rejections)("%s takes effect on a date in the current era", (_word, { since }) => {
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(since >= WIDE_BAND_START).toBe(true);
  });

  it.each(retired)("%s was playable the day before", (word, { since }) => {
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

// The derived rejections (src/data/derived-rejections.json, written by
// generate-data.py). Same shape of verdict as the hand-reviewed ones above -- the
// word keeps its dictionary slot and its rarity entry, and stops being playable
// from its dated batch on -- but read off Wiktionary's sense labels in bulk,
// because the family is thousands wide. Before this, a word could carry a reason
// and still be played, and an obsolete spelling scored on its own vanishing
// frequency: "ranck" came out 9.58 Mythic where "rank" scores 4.80.
const derivedBatches = Object.entries(derivedRejections as Record<string, Record<string, string[]>>);
const derivedEntries = derivedBatches.flatMap(([since, byReason]) =>
  Object.entries(byReason).flatMap(([reason, words]) => words.map((word) => ({ word, reason, since })))
);
const derivedByWord = new Map(derivedEntries.map((entry) => [entry.word, entry]));

describe("derived word rejections", () => {
  const batches = derivedBatches;
  // The wide-band cutover in dictionary.ts, same bound the reviewed rejections use.
  const WIDE_BAND_START = "2026-08-16";
  const entries = derivedEntries;
  const curatedWords = new Set(dictionaryWords);
  const zipfOf = new Map(dictionaryWords.map((word, i) => [word, rarityData.zipfHundredths[i]]));
  // Above this a corpus still measures the word in live use, which outranks an
  // out-of-use label -- see write_derived_rejections in scripts/generate-data.py.
  const OUT_OF_USE_REASONS = new Set(["obsolete", "archaic", "dated"]);
  const ZIPF_CEILING_HUNDREDTHS = 250;

  it("rejects an obsolete spelling that used to out-score the word it spells", () => {
    expect(curatedRejection("ranck")).toBe("obsolete");
    expect(isValidWord("ranck")).toBe(false);
    expect(evaluateSubmission("ranck", "anc", [])).toEqual({ ok: false, reason: "obsolete" });
    // The word it is an obsolete form of is untouched.
    expect(isValidWord("rank")).toBe(true);
  });

  it("tells the player which reason it was", () => {
    // One live example per reason the file carries, so the reason travels all the
    // way to a message rather than collapsing into "not a word".
    expect(evaluateSubmission("betwixt", "wix", [])).toEqual({ ok: false, reason: "archaic" });
    expect(evaluateSubmission("alienist", "ien", [])).toEqual({ ok: false, reason: "dated" });
    expect(evaluateSubmission("prof", "rof", [])).toEqual({ ok: false, reason: "abbreviation" });
    expect(evaluateSubmission("mammon", "amm", [])).toEqual({ ok: false, reason: "proper-noun" });
  });

  it("keeps its reason vocabulary renderable by the submit flow", () => {
    for (const { reason, word } of entries) {
      expect(REJECTION_MESSAGES[reason], `${word} (${reason}) needs a message`).toBeTruthy();
    }
  });

  it("stays out of the way of puzzles played before its batch date", () => {
    for (const [since, byReason] of batches) {
      for (const [reason, words] of Object.entries(byReason)) {
        expect(curatedRejection(words[0], since)).toBe(reason);
        expect(curatedRejection(words[0], addDays(since, -1))).toBeUndefined();
        expect(isValidWord(words[0], addDays(since, -1))).toBe(true);
      }
    }
  });

  it("still scores a rejected word, so an archived puzzle keeps its result", () => {
    expect(rarityFor("ranck")).toBeDefined();
  });

  it("only lists dictionary words, and only measured ones for an out-of-use label", () => {
    for (const { word, reason } of entries) {
      expect(curatedWords.has(word), `${word} must stay in the dictionary`).toBe(true);
      if (OUT_OF_USE_REASONS.has(reason)) {
        expect(zipfOf.get(word), `${word} is common enough to outrank ${reason}`).toBeLessThan(
          ZIPF_CEILING_HUNDREDTHS
        );
      }
    }
  });

  it("judges each word once", () => {
    const words = entries.map(({ word }) => word);
    expect(new Set(words).size).toBe(words.length);
  });

  it("leaves current words carrying one out-of-use sense playable", () => {
    // Wiktionary tags every sense it records for these out of use -- "halt" (the
    // adjective meaning lame) obsolete, "thy" archaic, "fortnight" dated -- which
    // is exactly why the frequency gate exists.
    for (const word of ["halt", "fraught", "guerilla", "thy", "unto", "fortnight", "yea"]) {
      expect(curatedRejection(word), `${word} must stay playable`).toBeUndefined();
      expect(isValidWord(word)).toBe(true);
    }
  });

  it("never offers a rejected word as a drop's best possible answer", () => {
    // Sampled rather than exhaustive: bestWordForDrop scans the whole dictionary,
    // so one call per word would be thousands of full scans.
    for (const { word } of entries.slice(0, 25)) {
      expect(bestWordForDrop(word.slice(1, 4))?.word).not.toBe(word);
    }
  });

  it("takes effect on a date in the current era, never on a live puzzle", () => {
    for (const [since] of batches) {
      expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A batch dated into a puzzle already played would rewrite what that puzzle
      // accepted; one dated on the day it ships would change the word pool under a
      // player mid-game. Both are why generate-data.py dates a batch from tomorrow.
      expect(since >= WIDE_BAND_START).toBe(true);
    }
  });

  it("yields to a hand-reviewed verdict about the same word", () => {
    // The two files overlap: a word can be labelled obsolete in bulk and also
    // judged by hand, where the hand entry names the more specific fault ("atest"
    // is a misspelling of "attest", not merely archaic). The hand reason wins
    // wherever it is in force, and its earlier date is what the player sees first.
    const handJudged = Object.entries(
      wordRejections as Record<string, { reason: string; since: string }>
    ).filter(([word]) => derivedByWord.has(word));
    expect(handJudged.length).toBeGreaterThan(0);
    for (const [word, { reason, since }] of handJudged) {
      expect(curatedRejection(word), `${word} under the newest system`).toBe(reason);
      expect(curatedRejection(word, since), `${word} on its review date`).toBe(reason);
      const derivedSince = derivedByWord.get(word)!.since;
      if (since < derivedSince) {
        // In the window between the two dates only the hand verdict is in force.
        expect(curatedRejection(word, addDays(derivedSince, -1))).toBe(reason);
      }
    }
  });
});

// The keep-list (scripts/playable-exemptions.txt). It is load-bearing in two
// places -- it takes a word back out of the derived rejections, and it spares that
// word the ALWAYS_EXCLUDED_REASONS filter that would *delete* it on a full rebuild
// -- and both live in Python that this suite never runs. So the invariant is
// asserted against the shipped data instead: whatever the file lists must be
// playable, and must be absent from the generated rejections.
describe("playable exemptions", () => {
  // A plain text list rather than a module, so it comes in through Vite's ?raw
  // import -- the same file scripts/generate-data.py reads, not a copy of it.
  const exempt: string[] = exemptionsFile
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line !== "" && !line.startsWith("#"));

  it("lists words, so the cases below are not vacuous", () => {
    expect(exempt.length).toBeGreaterThan(0);
  });

  it.each(exempt)("%s is playable", (word) => {
    expect(curatedRejection(word)).toBeUndefined();
    expect(isValidWord(word), `${word} must be a dictionary word to be exempt`).toBe(true);
  });

  it("keeps every exempt word out of the generated rejections", () => {
    for (const word of exempt) {
      expect(derivedByWord.has(word), `${word} is exempt but still rejected`).toBe(false);
    }
  });

  it("does not exempt a word a hand review rejected", () => {
    // The keep-list answers a bad *label*; it must not quietly overturn a verdict
    // someone reached deliberately, which it cannot do anyway -- curatedRejection
    // reads word-rejections.json first -- so an entry like that is a mistake.
    for (const word of exempt) {
      expect(word in wordRejections, `${word} is both exempt and hand-rejected`).toBe(false);
    }
  });
});
