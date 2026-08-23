import { describe, expect, it } from "vitest";
import dictionaryWords from "../data/dictionary.json";
import sameRootPins from "../data/same-root-pins.json";
import { evaluateSubmission, sameRootKey } from "./submit";
import { isValidWord } from "./dictionary";
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

describe("ordering, not frequency, decides the key", () => {
  it("never offers a stem-changing guess when a plain strip lands on a word", () => {
    // The coincidences scoring has to live with -- "caves" offering "cafe"
    // (4.09) a hair under "cave" (4.20), "saves" offering "safe" -- cannot
    // arise here: a decisive strip is consulted first and ends the search, and
    // the stem-changing family is not where either coincidence lives anyway.
    expect(allowed("cafe", "caves", "CA", AFTER)).toBe(true);
    expect(allowed("safe", "saves", "SA", AFTER)).toBe(true);
    // "cav" is itself a curated word, so it keeps the key it has today and
    // "cave"/"caves" stay playable together -- a leak, not a refusal.
    expect(sameRootKey("caves", AFTER)).toBe("cav");
  });

  it("keeps a key that already worked, rather than restoring an e over it", () => {
    // "playe" is in the dictionary, so a bare e-restoration would key "played"
    // onto it and let a puzzle take "play" and "played" both.
    expect(isValidWord("playe", AFTER)).toBe(true);
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
  it("only ever fills a hole: a key that was already playable stays on the chain", () => {
    // The widening may take a key *further* ("womens" -> "women" -> "woman"),
    // never sideways. So wherever the old key was itself a playable word, the
    // new key is what that old key folds to -- which is what guarantees no
    // legitimate pair that collapses today comes apart tomorrow.
    for (const word of WORDS) {
      const before = sameRootKey(word, BEFORE);
      if (!isValidWord(before, AFTER)) continue;
      expect(sameRootKey(before, AFTER), word).toBe(sameRootKey(word, AFTER));
    }
  });

  it("keys every word onto a playable word or onto itself, never onto a fragment", () => {
    // A fragment is a key two unrelated words can share ("grapes" and "graps"
    // both land on "grap" today). Refusing to key onto one is what dissolves
    // those false pairs, and it is the property the whole rule rests on.
    for (const word of WORDS) {
      const key = sameRootKey(word, AFTER);
      if (key === word) continue;
      expect(isValidWord(key, AFTER), `${word} -> ${key}`).toBe(true);
    }
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
