import { describe, expect, it } from "vitest";
import rejectionMetadata from "../data/rejection-metadata.json";
import { isValidWord } from "./dictionary";
import {
  containsDropInOrder,
  evaluateSubmission,
  REJECTION_LEADS,
  REJECTION_MESSAGES,
  spellingNearMiss,
} from "./submit";
import type { AcceptedWord } from "./types";

describe("containsDropInOrder", () => {
  it("matches a contiguous, in-order substring", () => {
    expect(containsDropInOrder("strength", "str")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(containsDropInOrder("STRENGTH", "str")).toBe(true);
  });

  it("rejects the same letters out of order", () => {
    expect(containsDropInOrder("rats", "str")).toBe(false);
  });

  it("rejects the letters split apart", () => {
    // s...t...r present but not contiguous
    expect(containsDropInOrder("sort", "str")).toBe(false);
  });
});

describe("evaluateSubmission", () => {
  it("says it in the lead, and says no more than it has to", () => {
    expect(REJECTION_MESSAGES["proper-noun"]).toBe("Proper noun. Names aren't playable.");
    // A known misspelling reads exactly like a near-miss: same mistake, same nudge.
    expect(REJECTION_MESSAGES.misspelling).toBe("Misspelling? Check your spelling.");
    expect(REJECTION_MESSAGES.misspelling).toBe(REJECTION_MESSAGES["check-your-spelling"]);
    expect(REJECTION_MESSAGES["missing-drop"]).toBe("Missing the drop. Your word must contain it.");
    expect(REJECTION_MESSAGES["not-a-word"]).toBe("Not found. Not in available dictionaries.");
    // The lead is the whole message where nothing else has to be said.
    expect(REJECTION_MESSAGES["already-used"]).toBe("Already used.");
    expect(REJECTION_MESSAGES.empty).toBe("Type a word first.");
  });

  it("keeps every rejection to a lead and at most one clause after it", () => {
    for (const [reason, message] of Object.entries(REJECTION_MESSAGES)) {
      expect(message.split(". ").length, `${reason} says too much`).toBeLessThanOrEqual(2);
      expect(message.length, `${reason} is too long to skim`).toBeLessThanOrEqual(45);
    }
  });

  it("gives every reason but the empty submission a lead its message opens with", () => {
    for (const [reason, message] of Object.entries(REJECTION_MESSAGES)) {
      if (reason === "empty") {
        expect(REJECTION_LEADS[reason]).toBeUndefined();
        continue;
      }
      const lead = REJECTION_LEADS[reason];
      expect(lead, `${reason} needs a lead`).toBeTruthy();
      expect(message.startsWith(lead), `${reason} must open with its lead`).toBe(true);
    }
  });

  it("rejects an empty submission", () => {
    const result = evaluateSubmission("   ", "the", []);
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects input with non-letter characters before checking the drop", () => {
    const result = evaluateSubmission("wo123", "wo", []);
    expect(result).toEqual({ ok: false, reason: "not-a-word" });
  });

  it("rejects a word that doesn't contain the drop", () => {
    const result = evaluateSubmission("the", "xyz", []);
    expect(result).toEqual({ ok: false, reason: "missing-drop" });
  });

  it("rejects the drop itself as an answer", () => {
    const result = evaluateSubmission("AT", "at", []);
    expect(result).toEqual({ ok: false, reason: "same-as-drop" });
  });

  it("rejects a word not in the dictionary", () => {
    const result = evaluateSubmission("zzzzqx", "zz", []);
    expect(result).toEqual({ ok: false, reason: "not-a-word" });
  });

  it("explains rejected proper names and abbreviations from ESDB metadata", () => {
    expect(evaluateSubmission("Paris", "ari", [])).toEqual({
      ok: false,
      reason: "name-or-abbreviation",
    });
    expect(evaluateSubmission("FBI", "fb", [])).toEqual({
      ok: false,
      reason: "abbreviation",
    });
  });

  it("explains words ESDB marks as not current modern English", () => {
    expect(evaluateSubmission("abactor", "act", [])).toEqual({
      ok: false,
      reason: "obsolete",
    });
  });

  it("distinguishes archaic and dated words via Wiktionary metadata", () => {
    // "brast" (archaic past tense of burst) and "abrasure" (dated) are excluded
    // words Wiktextract tags out of current use -- each gets its own message.
    expect(evaluateSubmission("brast", "ras", [])).toEqual({
      ok: false,
      reason: "archaic",
    });
    expect(evaluateSubmission("abrasure", "bra", [])).toEqual({
      ok: false,
      reason: "dated",
    });
  });

  it("rejects a curated word that carries an out-of-use reason, and says which", () => {
    // These stay in the dictionary so archived puzzles keep scoring them (see the
    // derived rejections in dictionary.test.ts); they just can't be submitted.
    expect(evaluateSubmission("sovran", "ovr", [])).toEqual({ ok: false, reason: "archaic" });
    expect(evaluateSubmission("ranck", "anc", [])).toEqual({ ok: false, reason: "obsolete" });
  });

  it("keeps old-sounding words a corpus still measures playable", () => {
    // "thy" (Zipf 4.11) is tagged archaic and "fortnight" (3.41) dated, but both
    // are in live use, and the frequency gate is what keeps them in play.
    for (const [word, drop] of [
      ["thy", "th"],
      ["fortnight", "tni"],
    ]) {
      const result = evaluateSubmission(word, drop, []);
      expect(result.ok, `${word} should be playable`).toBe(true);
      expect(result.word?.word).toBe(word);
    }
  });

  it("accepts a valid word containing the drop without matching it exactly", () => {
    const result = evaluateSubmission("thee", "the", []);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("thee");
  });

  it("accepts curtaining even though wordfreq has no direct estimate", () => {
    const result = evaluateSubmission("curtaining", "tain", []);

    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("curtaining");
  });

  it("trims and lowercases the input before validating", () => {
    const result = evaluateSubmission("  THEE  ", "the", []);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("thee");
  });

  it("rejects an exact repeat of an already-accepted word", () => {
    const already: AcceptedWord[] = [{ word: "start", rarity: "Common", zipf: 5 }];
    const result = evaluateSubmission("start", "art", already);
    expect(result).toEqual({ ok: false, reason: "already-used" });
  });

  it("rejects a word sharing a root with an already-accepted word", () => {
    const already: AcceptedWord[] = [{ word: "start", rarity: "Common", zipf: 5 }];
    const result = evaluateSubmission("starting", "art", already);
    expect(result).toEqual({ ok: false, reason: "same-root-as-used" });
  });

  it("accepts a second word with a genuinely different root", () => {
    const already: AcceptedWord[] = [{ word: "start", rarity: "Common", zipf: 5 }];
    const result = evaluateSubmission("smart", "art", already);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("smart");
  });

  it("folds a bound derivational form onto its base for same-root detection", () => {
    // From the wide-band era, "organization" shares a root with "organize".
    const already: AcceptedWord[] = [{ word: "organize", rarity: "Common", zipf: 3.98 }];
    const result = evaluateSubmission("organization", "gan", already);
    expect(result).toEqual({ ok: false, reason: "same-root-as-used" });
  });

  it("leaves opaque suffixes as their own root (battlement is not battle)", () => {
    const already: AcceptedWord[] = [{ word: "battle", rarity: "Common", zipf: 4.94 }];
    const result = evaluateSubmission("battlement", "att", already);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("battlement");
  });

  it("does not fold bound suffixes for pre-cutover puzzles", () => {
    // Before 2026-08-16 the base-form folding is off, so past puzzles are frozen.
    const already: AcceptedWord[] = [{ word: "organize", rarity: "Common", zipf: 3.98 }];
    const result = evaluateSubmission("organization", "gan", already, "2026-08-15");
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("organization");
  });
});

describe("rejection metadata coverage", () => {
  // Per-reason word counts shipped in src/data/rejection-metadata.json, pinned so
  // a data regen that unexpectedly grows or shrinks a bucket is caught in review.
  // Regenerated by scripts/generate-data.py; update these when the data changes.
  const expectedCounts: Record<string, number> = {
    abbreviation: 1821,
    archaic: 10309,
    dated: 2108,
    misspelling: 7,
    "name-or-abbreviation": 11588,
    obsolete: 63353,
    "proper-noun": 18242,
  };
  const metadata = rejectionMetadata as Record<string, readonly string[]>;

  it("pins how many words received each rejection reason", () => {
    const actualCounts = Object.fromEntries(
      Object.entries(metadata).map(([reason, words]) => [reason, words.length]),
    );
    expect(actualCounts).toEqual(expectedCounts);
  });

  it("pins the total number of words with a rejection reason", () => {
    const total = Object.values(metadata).reduce((sum, words) => sum + words.length, 0);
    expect(total).toBe(107_428);
  });

  // These six carried no frequency from any corpus, so they scored the
  // unattested sentinel's perfect 10 -- a misspelling outranking every real word
  // a player could find. Flagged as misspellings so they're rejected outright and
  // a regen can't quietly reinstate them.
  const removedMisspellings = [
    "exhilirative",
    "reaexportation",
    "reassimiliate",
    "reassimiliated",
    "reassimiliates",
    "reassimiliating",
  ];

  it.each(removedMisspellings)("rejects %s as a misspelling", (word) => {
    expect(isValidWord(word)).toBe(false);
    // The drop is checked before the word is looked up, so use a substring of the
    // word itself -- otherwise these bounce on "missing-drop" and never reach the
    // metadata lookup we're actually asserting on.
    const result = evaluateSubmission(word, word.slice(1, 4), []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("misspelling");
  });

  it("keeps the correctly spelled words those typos shadowed", () => {
    expect(isValidWord("exhilarative")).toBe(true);
    expect(isValidWord("reexportation")).toBe(true);
  });
});

describe("spellingNearMiss", () => {
  it("finds the playable word a typo is one letter from", () => {
    // "abatement" is playable for the "ate" drop; "abatemant" is not a word.
    expect(isValidWord("abatemant")).toBe(false);
    expect(spellingNearMiss("abatemant", "ate", [])).toBe("abatement");
  });

  it("catches a dropped letter and a doubled one, each being one edit", () => {
    expect(spellingNearMiss("abatemnt", "ate", [])).toBe("abatement");
    expect(spellingNearMiss("abatementt", "ate", [])).toBe("abatement");
  });

  it("allows two letters off once the guess is long enough to afford it", () => {
    // Nine letters, two edits from "abatement" and one edit from nothing.
    expect(spellingNearMiss("abatemanq", "ate", [])).toBe("abatement");
    // Which is what catches a transposition, since it costs two edits.
    expect(spellingNearMiss("abatemetn", "ate", [])).toBe("abatement");
  });

  it("holds a shorter guess to one letter, where two would reach a quarter of made-up words", () => {
    // Seven letters, two edits from "actuate" and more than two from anything else.
    expect(isValidWord("aqtqate")).toBe(false);
    expect(spellingNearMiss("aqtqate", "ate", [])).toBeUndefined();
  });

  it("normalizes the guess the way a submission does", () => {
    expect(spellingNearMiss("  ABATEMANT  ", "ATE", [])).toBe("abatement");
  });

  it("says nothing about a guess that isn't close to anything", () => {
    expect(spellingNearMiss("qxzatevbnm", "ate", [])).toBeUndefined();
  });

  it("ignores a guess too short for one edit to be evidence of a typo", () => {
    // "grate" is a letter from "grste", but at five letters most invented words
    // are a letter from something, so nothing is claimed.
    expect(isValidWord("grate")).toBe(true);
    expect(spellingNearMiss("grste", "ate", [])).toBeUndefined();
    expect(spellingNearMiss("qate", "ate", [])).toBeUndefined();
  });

  it("never points at a word this puzzle has already taken", () => {
    const used: AcceptedWord[] = [{ word: "abatement", rarity: "Rare", zipf: 3 }];
    // Only that one word is within reach of this guess, so removing it from the
    // pool leaves nothing to nudge toward.
    expect(spellingNearMiss("abatemant", "ate", [])).toBe("abatement");
    expect(spellingNearMiss("abatemant", "ate", used)).toBeUndefined();
  });

  it("never points at a word the same-root rule would refuse", () => {
    const used: AcceptedWord[] = [{ word: "abatements", rarity: "Rare", zipf: 3 }];
    expect(spellingNearMiss("abatemant", "ate", used)).toBeUndefined();
  });

  it("ignores a guess that isn't letters at all", () => {
    expect(spellingNearMiss("abate-mant", "ate", [])).toBeUndefined();
  });

  it("only nudges toward words that contain the drop", () => {
    // Same guess, a drop no word within reach of it carries: nothing to suggest,
    // because a nearby word that misses the drop wouldn't be playable either.
    expect(spellingNearMiss("abatemant", "zzz", [])).toBeUndefined();
  });
});
