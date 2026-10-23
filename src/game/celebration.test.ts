import { describe, expect, it } from "vitest";
import { celebrationFor, hapticPatternFor, isNewBest, rollingValue } from "./celebration";
import type { AcceptedWord } from "./types";

function word(text: string, zipf: number): AcceptedWord {
  return { word: text, zipf, rarity: "Rare" };
}

describe("celebrationFor", () => {
  it("scales the celebration with the tier", () => {
    expect(celebrationFor("Common")).toBe("none");
    expect(celebrationFor("Uncommon")).toBe("none");
    expect(celebrationFor("Rare")).toBe("burst");
    expect(celebrationFor("Elusive")).toBe("burst");
    expect(celebrationFor("Mythic")).toBe("grand");
    expect(celebrationFor("Legend")).toBe("grand");
  });
});

describe("hapticPatternFor", () => {
  it("vibrates longer for rarer words", () => {
    const total = (pattern: number[]) => pattern.reduce((a, b) => a + b, 0);
    expect(total(hapticPatternFor("Common"))).toBeLessThan(total(hapticPatternFor("Rare")));
    expect(total(hapticPatternFor("Rare"))).toBeLessThan(total(hapticPatternFor("Legend")));
  });
});

describe("isNewBest", () => {
  it("is never the first word of the day", () => {
    expect(isNewBest([word("alpha", 2)])).toBe(false);
  });

  it("is the latest word when it is rarer than every earlier one", () => {
    expect(isNewBest([word("alpha", 3), word("beta", 2)])).toBe(true);
    expect(isNewBest([word("alpha", 3), word("beta", 1), word("gamma", 2)])).toBe(false);
  });

  it("is not a tie", () => {
    expect(isNewBest([word("alpha", 2), word("beta", 2)])).toBe(false);
  });
});

describe("rollingValue", () => {
  it("starts at zero, ends on the target and never overshoots", () => {
    expect(rollingValue(9.5, 0)).toBe(0);
    expect(rollingValue(9.5, 1)).toBe(9.5);
    expect(rollingValue(9.5, 2)).toBe(9.5);
    expect(rollingValue(9.5, 0.5)).toBeGreaterThan(9.5 / 2);
    expect(rollingValue(9.5, 0.5)).toBeLessThan(9.5);
  });
});
