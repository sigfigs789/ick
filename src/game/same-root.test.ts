import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import sameRootPins from "../data/same-root-pins.json";
import { evaluateSubmission, sameRootKey } from "./submit";
import { isDictionaryWord, isValidWord, refusedEsStem, refusedTenseStem } from "./dictionary";
import {
  decisiveNumberCandidates,
  inflectionalBaseCandidates,
  stemChangingNumberCandidates,
} from "./stem";
import type { AcceptedWord } from "./types";

// Either side of the 2026-08-24 same-root cutover.
const BEFORE = "2026-08-23";
const AFTER = "2026-08-24";

function played(...words: string[]): AcceptedWord[] {
  return words.map((word) => ({ word, rarity: "Common" as const, zipf: 4 }));
}

/** Whether `second` may be played in a puzzle that has already taken `first`. */
function allowed(first: string, second: string, drop: string, date: string): boolean {
  const result = evaluateSubmission(second, drop, played(first), date);
  if (!result.ok && result.reason !== "same-root-as-used") {
    throw new Error(`${second} after ${first} was rejected as ${result.reason}, not on root`);
  }
  return result.ok;
}

describe("the same-root rule reads the inflections baseForm misses", () => {
  // Each row is a pair a puzzle could take as two separate finds before the
  // cutover, with the drop that reaches both.
  const pairs: ReadonlyArray<[first: string, second: string, drop: string]> = [
    // "-es" where the base keeps its e -- the widest hole, ~12,000 words.
    ["asphyxiate", "asphyxiates", "PHY"],
    ["score", "scores", "OR"],
    // The silent e an "-ed"/"-ing" strip swallows.
    ["indicate", "indicated", "CAT"],
    ["indicate", "indicating", "CAT"],
    ["confuse", "confusing", "US"],
    // Five-letter "-ied"/"-ies", which baseForm's six-letter guards drop.
    ["pry", "pries", "PR"],
    // "-ied" whose base ends in i: baseForm rewrites the stem to "-y" and never
    // tries the plain strip, so "taxied" reached neither "taxie" nor "taxi".
    ["taxi", "taxied", "AX"],
    // The stem-changing plurals, where the dictionary does not also attest the
    // fragment the decisive strip lands on (it does for "wolves" -> "wolve", so
    // that pair stays playable -- see rootKey).
    ["aardwolf", "aardwolves", "WOL"],
    ["jackknife", "jackknives", "KKN"],
    ["emphasis", "emphases", "PHA"],
    ["vortex", "vortices", "ORT"],
    ["crewman", "crewmen", "REW"],
    // A chain, not one hop: "womens" -> "women" -> "woman".
    ["woman", "womens", "OM"],
  ];

  it.each(pairs)("refuses %s + %s from the cutover on", (first, second, drop) => {
    expect(allowed(first, second, drop, AFTER)).toBe(false);
    expect(allowed(second, first, drop, AFTER)).toBe(false);
  });

  it.each(pairs)("leaves %s + %s alone before it", (first, second, drop) => {
    expect(allowed(first, second, drop, BEFORE)).toBe(true);
  });

  it("walks a chain to its end, so a key is never one hop short", () => {
    // "dyings" -> "dying" -> "die": before the walk, "dyings" stopped on "dying"
    // and the two of them keyed apart. (No drop reaches both "die" and "dyings",
    // so this one is a key test rather than a submission test.)
    expect(sameRootKey("dyings", AFTER)).toBe("die");
    expect(sameRootKey("dying", AFTER)).toBe("die");
    expect(sameRootKey("womens", AFTER)).toBe("woman");
  });

  it("takes four finds off one verb down to one", () => {
    const forms = ["indicate", "indicates", "indicated", "indicating"];
    for (const form of forms.slice(1)) {
      expect(evaluateSubmission(form, "CAT", played("indicate"), AFTER)).toEqual({
        ok: false,
        reason: "same-root-as-used",
      });
    }
  });
});

describe("the two tiers, and what each one protects", () => {
  it("never reaches a stem-changing guess when tier 1 finds anything", () => {
    // The two coincidences scoring has to live with -- "caves" offering "cafe"
    // (4.09) a hair under "cave" (4.20), "saves" offering "safe" (5.07) under
    // "save" (5.14) -- cannot arise here at all. Both words settle in tier 1, so
    // the "-ves" reading that produces "cafe" and "safe" is never consulted, and
    // no data refresh can flip a margin that thin into a refusal.
    expect(sameRootKey("caves", AFTER)).toBe("cave");
    expect(sameRootKey("saves", AFTER)).toBe("save");
    expect(allowed("cafe", "caves", "CA", AFTER)).toBe(true);
    expect(allowed("safe", "saves", "SA", AFTER)).toBe(true);
  });

  it("ranks the whole tier, so a plural and its own tenses agree", () => {
    // Nothing in the spelling says whether "bathing" came from "bath" or
    // "bathe". What matters is that every form of the paradigm answers the same
    // way, which ranking the tier as a whole guarantees and rule-ordering did
    // not: ordering sent "-es" forms to the e-spelling and "-ing" forms to the
    // bare stem, splitting 3,000 pairs.
    expect(sameRootKey("bathes", AFTER)).toBe(sameRootKey("bathing", AFTER));
    for (const form of ["advocates", "advocated", "advocating"]) {
      expect(sameRootKey(form, AFTER), form).toBe("advocate");
    }
  });

  it("never reads an -ees plural as an -es form of a verb", () => {
    // English adds "-s", not "-es", to a word ending in "e", so the two-letter
    // strip is not a reading of "-ees" at all -- and frequency preferred it,
    // because the verb is the commoner word. Left in, it refused "devotees" to a
    // player who had found "devote".
    for (const [plural, noun, verb] of [
      ["devotees", "devotee", "devote"],
      ["advisees", "advisee", "advise"],
      ["bargees", "bargee", "barge"],
    ]) {
      expect(sameRootKey(plural, AFTER), plural).toBe(noun);
      expect(allowed(verb, plural, verb.slice(0, 3), AFTER), plural).toBe(true);
    }
    // The "-ee" verbs are unaffected: their base ends in "-ee" either way.
    expect(sameRootKey("agrees", AFTER)).toBe("agree");
    expect(sameRootKey("guarantees", AFTER)).toBe("guarantee");
  });

  it("keys a paradigm on its fragment when the dictionary has no base for it", () => {
    // The curated list has no "bitch", so the fragment is the only thing these
    // three share -- and before the cutover it was how they met. A fragment stays
    // the fallback for exactly that reason; what it no longer does is capture
    // words that have a real base ("grapes" leaves "graps" behind on "grap").
    expect(isValidWord("bitch", AFTER)).toBe(false);
    expect(sameRootKey("bitched", AFTER)).toBe(sameRootKey("bitching", AFTER));
    expect(sameRootKey("grapes", AFTER)).toBe("grape");
    expect(sameRootKey("graps", AFTER)).toBe("grap");
  });

  it("keeps a key that already worked, rather than restoring an e over it", () => {
    // "playe" is in the dictionary -- unplayable, but real -- so it is a
    // candidate here, and a rule that preferred the restored "e" would key
    // "played" onto it and let a puzzle take "play" and "played" both. Only
    // frequency separates the two (5.63 against 0.30).
    expect(isDictionaryWord("playe")).toBe(true);
    expect(isValidWord("playe", AFTER)).toBe(false);
    expect(sameRootKey("played", AFTER)).toBe("play");
    expect(allowed("play", "played", "LA", AFTER)).toBe(false);
  });

  it("leaves a doubled stem on its own base rather than guessing an e", () => {
    // "hopped" -> "hop", never the wrong-verb "hope".
    expect(sameRootKey("hopped", AFTER)).toBe("hop");
    expect(allowed("hope", "hopped", "OP", AFTER)).toBe(true);
  });
});

describe("reviewed pins settle what no ordering can", () => {
  it("keeps the plural of thesis away from `these`", () => {
    // The decisive "-s" strip lands on the unrelated "these", and so does the
    // most-common-candidate rule scoring uses. Only a review gets this right.
    expect(sameRootKey("theses", AFTER)).toBe(sameRootKey("thesis", AFTER));
    expect(allowed("these", "theses", "ESE", AFTER)).toBe(true);
    expect(allowed("thesis", "theses", "ESE", AFTER)).toBe(false);
  });

  it("keeps the words that merely end in -men off the -man plural", () => {
    for (const [word, lookalike] of [
      ["germen", "german"],
      ["dolmen", "dolman"],
      ["limen", "liman"],
      ["somen", "soman"],
      ["nomen", "noman"],
    ]) {
      expect(sameRootKey(word, AFTER)).toBe(word);
      expect(allowed(lookalike, word, word.slice(1, 3), AFTER)).toBe(true);
    }
  });

  it("applies a pin only from the puzzle it was reviewed for", () => {
    expect(sameRootKey("theses", BEFORE)).not.toBe(sameRootKey("thesis", BEFORE));
  });

  it("pins only words the dictionary actually has", () => {
    for (const [word, pin] of Object.entries(
      sameRootPins as Record<string, { root: string; since: string }>
    )) {
      expect(isValidWord(word, AFTER), word).toBe(true);
      expect(isValidWord(pin.root, AFTER), pin.root).toBe(true);
    }
  });
});

const WORDS = dictionaryWords as string[];

describe("invariants across the whole dictionary", () => {
  it("merges far more than it splits, and both counts hold still", () => {
    // The tripwire for the whole change. Measured at the cutover: 40,621 pairs
    // that a puzzle could take as two finds now collapse, and 2,501 that
    // collapse today come apart -- unrelated words that shared a fragment
    // ("rates"/"rats"), plus curated truncations that keep their own key while
    // their paradigm moves to the full spelling ("ach"/"ached"). Thresholds
    // rather than exact numbers, since the dictionary is data and may grow.
    const before = new Map(WORDS.map((word) => [word, sameRootKey(word, BEFORE)]));
    const after = new Map(WORDS.map((word) => [word, sameRootKey(word, AFTER)]));
    const group = (keys: Map<string, string>) => {
      const groups = new Map<string, string[]>();
      for (const word of WORDS) {
        const key = keys.get(word)!;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(word);
      }
      return [...groups.values()].filter((words) => words.length > 1);
    };
    const countPairs = (groups: string[][], same: (a: string, b: string) => boolean) => {
      let pairs = 0;
      for (const words of groups) {
        for (let i = 0; i < words.length; i++) {
          for (let j = i + 1; j < words.length; j++) if (!same(words[i], words[j])) pairs++;
        }
      }
      return pairs;
    };
    const merged = countPairs(group(after), (a, b) => before.get(a) === before.get(b));
    const split = countPairs(group(before), (a, b) => after.get(a) === after.get(b));
    expect(merged).toBeGreaterThan(40_000);
    expect(split).toBeLessThan(2_600);
  });

  it("splits the two halves of the scoring stemmer without changing it", () => {
    // Duplicate detection needs the decisive strips apart from the stem-changing
    // guesses; scoring wants the union, and takes a maximum over it, so only the
    // set matters.
    for (const word of WORDS) {
      const halves = [...decisiveNumberCandidates(word), ...stemChangingNumberCandidates(word)];
      expect(new Set(inflectionalBaseCandidates(word, false)), word).toEqual(new Set(halves));
    }
  });

  it("reaches a fixed point, so a key is never one hop short", () => {
    for (const word of WORDS) {
      const key = sameRootKey(word, AFTER);
      expect(sameRootKey(key, AFTER), word).toBe(key);
    }
  });
});

// The 2026-09-10 cutover: the readings English does not spell are dropped before
// tier 1 is ranked, rather than ranked and usually preferred. Two endings, one
// claim -- see SAME_ROOT_DOUBLING_START in dictionary.ts, and `refusedTenseStem`
// and `refusedEsStem` for the spelling arguments.
describe("the readings English does not spell (from 2026-09-10)", () => {
  const BEFORE_SPELLING = "2026-09-09";
  const ON_SPELLING = "2026-09-10";

  it("stops refusing a word that is not a form of what a player found", () => {
    // The class this exists for, and the worst kind of bug this file can have:
    // each pair is two different words, and the second was refused to anyone who
    // had found the first. "wan" conjugates as "wanning", so "waning" was never
    // its participle; "ban" writes "bans", so "banes" was never its plural.
    for (const [found, refused, drop] of [
      ["wan", "waning", "ANI"],
      ["wan", "waned", "ANE"],
      ["ban", "banes", "ANE"],
      ["bit", "biting", "TIN"],
      ["star", "stares", "TAR"],
      ["man", "manes", "ANE"],
      ["flu", "flues", "LUE"],
    ] as const) {
      expect(allowed(found, refused, drop, BEFORE_SPELLING), `${refused} before`).toBe(false);
      expect(allowed(found, refused, drop, ON_SPELLING), `${refused} after`).toBe(true);
    }
  });

  it("puts the paradigm back together on the -e spelling", () => {
    // The other side of the same move: the forms that were keyed on an unrelated
    // stem rejoin the lemma they belong to, so a puzzle stops taking two of them.
    for (const [lemma, form, drop] of [
      ["wane", "waning", "ANI"],
      ["bane", "banes", "ANE"],
      ["flue", "flues", "LUE"],
      ["hone", "honed", "ONE"],
      ["kite", "kiting", "ITI"],
      ["spine", "spines", "PIN"],
    ] as const) {
      expect(allowed(lemma, form, drop, BEFORE_SPELLING), `${form} before`).toBe(true);
      expect(allowed(lemma, form, drop, ON_SPELLING), `${form} after`).toBe(false);
    }
    // The whole `wane` paradigm on one key and the whole `wan` paradigm on
    // another -- two verbs that share a spelling of the stem and nothing else.
    for (const word of ["wane", "waned", "wanes", "waning"]) {
      expect(sameRootKey(word, ON_SPELLING), word).toBe("wane");
    }
    for (const word of ["wan", "wanned", "wanning", "wans"]) {
      expect(sameRootKey(word, ON_SPELLING), word).toBe("wan");
    }
  });

  it("keys no word on a reading its own spelling rules out", () => {
    // The change, over the dictionary rather than on the samples above: 717
    // words were keyed on a spelling English does not produce, and none is now.
    const refusedFor = (word: string) =>
      [refusedTenseStem(word), refusedEsStem(word)].filter((stem) => stem !== undefined);
    const keyedOnRefused = (date: string) =>
      WORDS.filter((word) => refusedFor(word).includes(sameRootKey(word, date)));
    expect(keyedOnRefused(ON_SPELLING)).toEqual([]);
    expect(keyedOnRefused(BEFORE_SPELLING)).toHaveLength(717);
  });

  it("settles every pair it newly refuses on an -e word", () => {
    // What the repair looks like in aggregate: 756 pairs collapse, and every one
    // lands on the silent-"e" spelling -- the reading that was there all along
    // and losing to frequency. Nothing collapses onto a consonant stem, which is
    // what would signal the filter had eaten a legitimate reading instead.
    const before = new Map(WORDS.map((word) => [word, sameRootKey(word, BEFORE_SPELLING)]));
    const after = new Map(WORDS.map((word) => [word, sameRootKey(word, ON_SPELLING)]));
    const groups = new Map<string, string[]>();
    for (const word of WORDS) {
      const key = after.get(word)!;
      groups.set(key, [...(groups.get(key) ?? []), word]);
    }
    let collapsed = 0;
    const onConsonant: string[] = [];
    for (const [key, words] of groups) {
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          if (before.get(words[i]) === before.get(words[j])) continue;
          collapsed++;
          if (!key.endsWith("e")) onConsonant.push(`${words[i]}+${words[j]} on ${key}`);
        }
      }
    }
    expect(onConsonant).toEqual([]);
    expect(collapsed).toBe(756);
  });

  it("splits only pairs that met on a spelling neither word has", () => {
    // A leak, and the safe direction as everywhere else in this file -- but the
    // shape is worth pinning. No rule here strips a final "e", so an "-e" lemma
    // always keys on itself, which means it was *already* apart from every form
    // that keyed on the consonant stem. Anything moving onto the lemma is
    // therefore a repair, and the pairs that come apart are pairs that only ever
    // met on the bogus key: "ant" + "antes", "stamp" + "stampedes", "aid" +
    // "aides". 2,254 of them, against 756 repaired.
    const before = new Map(WORDS.map((word) => [word, sameRootKey(word, BEFORE_SPELLING)]));
    const after = new Map(WORDS.map((word) => [word, sameRootKey(word, ON_SPELLING)]));
    const groups = new Map<string, string[]>();
    for (const word of WORDS) {
      const key = before.get(word)!;
      groups.set(key, [...(groups.get(key) ?? []), word]);
    }
    let split = 0;
    for (const words of groups.values()) {
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          if (after.get(words[i]) !== after.get(words[j])) split++;
        }
      }
    }
    expect(split).toBe(2254);
    expect(WORDS.filter((word) => before.get(word) !== after.get(word))).toHaveLength(744);
  });

  it("keeps the reading English does spell, however common the rival", () => {
    // The rule is a spelling test, not a preference for the "-e" word, and these
    // are where the difference shows. A doubled stem ("hopped") and a stem with
    // a consonant cluster or two vowels ("bathing", "waiting") really can take
    // the ending bare, so the bare stem stays a candidate and frequency still
    // decides -- which is what keeps "bathes" and "bathing" answering alike.
    for (const [word, key] of [
      ["hopped", "hop"],
      ["played", "play"],
      ["bathes", "bath"],
      ["bathing", "bath"],
      ["waiting", "wait"],
      ["offering", "offer"],
      ["glasses", "glass"],
      ["boxes", "box"],
      ["potatoes", "potato"],
      ["taxies", "taxi"],
      ["clothes", "cloth"],
      ["advisees", "advisee"],
      ["grapes", "grape"],
      ["graps", "grap"],
    ] as const) {
      expect(sameRootKey(word, ON_SPELLING), word).toBe(key);
      expect(sameRootKey(word, ON_SPELLING), `${word} unmoved`).toBe(
        sameRootKey(word, BEFORE_SPELLING)
      );
    }
  });

  it("keeps `during` off the verb it descends from", () => {
    // The one wrong pairing the rule creates, and it takes a review: "during" is
    // the preposition, and with `dur` refused the only reading left is `dure`,
    // the archaic verb. The pin keeps them two finds. Scoring exempts the same
    // word for the same reason (see fold-exemptions.json).
    expect(sameRootKey("during", ON_SPELLING)).toBe("during");
    expect(sameRootKey("dure", ON_SPELLING)).toBe("dure");
    expect(allowed("dure", "during", "UR", ON_SPELLING)).toBe(true);
  });

  it("leaves archived puzzles keyed as they were played", () => {
    expect(sameRootKey("waning", BEFORE_SPELLING)).toBe("wan");
    expect(sameRootKey("banes", BEFORE_SPELLING)).toBe("ban");
    expect(allowed("wan", "waning", "ANI", "2026-08-24")).toBe(false);
  });

  it("still reaches a fixed point", () => {
    for (const word of WORDS) {
      const key = sameRootKey(word, ON_SPELLING);
      expect(sameRootKey(key, ON_SPELLING), word).toBe(key);
    }
  });
});
