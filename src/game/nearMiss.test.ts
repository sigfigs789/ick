import { describe, expect, it } from "vitest";
import {
  NEAR_MISS_MIN_LENGTH,
  NEAR_MISS_TWO_EDIT_MIN_LENGTH,
  nearMissEditBudget,
  withinEditDistance,
} from "./nearMiss";

describe("withinEditDistance", () => {
  it("counts a substitution, an insertion, and a deletion as one edit each", () => {
    expect(withinEditDistance("misspell", "mispell", 1)).toBe(true); // deletion
    expect(withinEditDistance("definately", "definitely", 1)).toBe(true); // substitution
    expect(withinEditDistance("occurence", "occurrence", 1)).toBe(true); // insertion
  });

  it("treats a transposition as two edits", () => {
    expect(withinEditDistance("recieve", "receive", 1)).toBe(false);
    expect(withinEditDistance("recieve", "receive", 2)).toBe(true);
  });

  it("matches identical words at any budget", () => {
    expect(withinEditDistance("abatement", "abatement", 0)).toBe(true);
  });

  it("rejects a length gap wider than the budget without comparing", () => {
    expect(withinEditDistance("ate", "abatement", 2)).toBe(false);
  });

  it("rejects words that differ by more than the budget", () => {
    expect(withinEditDistance("abatement", "statement", 1)).toBe(false);
    expect(withinEditDistance("abatement", "statement", 2)).toBe(true);
    expect(withinEditDistance("qqqqqqqqq", "abatement", 2)).toBe(false);
  });
});

describe("nearMissEditBudget", () => {
  it("skips words too short for one edit to mean anything", () => {
    expect(nearMissEditBudget("a".repeat(NEAR_MISS_MIN_LENGTH - 1))).toBe(0);
    expect(nearMissEditBudget("a".repeat(NEAR_MISS_MIN_LENGTH))).toBe(1);
  });

  it("spends the second edit only once the word is long enough to afford it", () => {
    expect(nearMissEditBudget("a".repeat(NEAR_MISS_TWO_EDIT_MIN_LENGTH - 1))).toBe(1);
    expect(nearMissEditBudget("a".repeat(NEAR_MISS_TWO_EDIT_MIN_LENGTH))).toBe(2);
    expect(nearMissEditBudget("a".repeat(30))).toBe(2);
  });

  it("keeps the two floors in the order the rule needs", () => {
    expect(NEAR_MISS_MIN_LENGTH).toBeLessThan(NEAR_MISS_TWO_EDIT_MIN_LENGTH);
  });
});
