import { describe, expect, it } from "vitest";
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
});
