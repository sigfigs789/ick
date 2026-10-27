import { describe, expect, it } from "vitest";
import { rarityScore } from "./dictionary";
import { flameLevel, shareFlameTier } from "./shareFlames";

const DATE = "2026-10-28";

/** A word whose score under DATE is `score`, found by bisecting the falling Zipf-to-score map. */
function scoring(score: number): { zipf: number } {
  let common = 8;
  let rare = -2;
  for (let step = 0; step < 60; step++) {
    const mid = (common + rare) / 2;
    if (rarityScore(mid, DATE) >= score) rare = mid;
    else common = mid;
  }
  return { zipf: rare };
}

describe("shareFlameTier", () => {
  it("names the tier the words' average score earns, from Elusive up", () => {
    expect(shareFlameTier([scoring(8.8), scoring(9.4)], DATE)).toBe("Elusive");
    expect(shareFlameTier([scoring(9.2), scoring(10)], DATE)).toBe("Mythic");
    expect(shareFlameTier([scoring(9.9), scoring(10)], DATE)).toBe("Legend");
  });

  it("goes by the average, not the best word", () => {
    expect(shareFlameTier([scoring(10), scoring(5)], DATE)).toBeNull();
    expect(shareFlameTier([scoring(10), scoring(8.2)], DATE)).toBe("Elusive");
  });

  it("does not burn below Elusive, or with no words", () => {
    expect(shareFlameTier([scoring(7.8)], DATE)).toBeNull();
    expect(shareFlameTier([scoring(8.2), scoring(8.6)], DATE)).toBeNull();
    expect(shareFlameTier([], DATE)).toBeNull();
  });

  it("does not burn on a puzzle whose tiers a score cannot name", () => {
    expect(shareFlameTier([scoring(10)], "2026-08-01")).toBeNull();
  });
});

describe("flameLevel", () => {
  it("burns larger each tier up", () => {
    expect(flameLevel("Elusive")).toBe(1);
    expect(flameLevel("Mythic")).toBe(2);
    expect(flameLevel("Legend")).toBe(3);
  });
});
