import { describe, expect, it } from "vitest";
import rejectionMetadata from "../data/rejection-metadata.json";
import { containsDropInOrder, evaluateSubmission, REJECTION_MESSAGES } from "./submit";
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
  it("uses concise diagnostic messages for word-rule rejections", () => {
    expect(REJECTION_MESSAGES["proper-noun"]).toBe("This looks like a proper noun.");
    expect(REJECTION_MESSAGES.abbreviation).toBe("This looks like an abbreviation or acronym.");
    expect(REJECTION_MESSAGES["name-or-abbreviation"]).toBe("This looks like a proper noun or abbreviation.");
    expect(REJECTION_MESSAGES.obsolete).toBe("This looks archaic or obsolete.");
    expect(REJECTION_MESSAGES.archaic).toBe("This looks like an archaic word.");
    expect(REJECTION_MESSAGES.dated).toBe("This looks dated — no longer in common use.");
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

  it("keeps recognizable archaic words playable (no retroactive removals)", () => {
    // Classic archaic words like "betwixt" remain in the dictionary; the new
    // tags only ever add a message to a word that was already excluded.
    const result = evaluateSubmission("betwixt", "wix", []);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("betwixt");
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
    "name-or-abbreviation": 11590,
    obsolete: 63353,
    "proper-noun": 18243,
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
    expect(total).toBe(107_424);
  });
});
