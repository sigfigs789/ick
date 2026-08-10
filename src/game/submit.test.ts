import { describe, expect, it } from "vitest";
import { containsDropInOrder, evaluateSubmission } from "./submit";
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

  it("rejects a word not in the dictionary", () => {
    const result = evaluateSubmission("zzzzqx", "zz", []);
    expect(result).toEqual({ ok: false, reason: "not-a-word" });
  });

  it("accepts a valid word containing the drop", () => {
    const result = evaluateSubmission("the", "the", []);
    expect(result.ok).toBe(true);
    expect(result.word).toEqual({ word: "the", rarity: "Very Common", zipf: 7.7 });
  });

  it("trims and lowercases the input before validating", () => {
    const result = evaluateSubmission("  THE  ", "the", []);
    expect(result.ok).toBe(true);
    expect(result.word?.word).toBe("the");
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
