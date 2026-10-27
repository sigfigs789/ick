import { afterEach, describe, expect, it } from "vitest";
import { rarityScore } from "./dictionary";
import {
  assignShareFlamesArm,
  drawnShareFlamesArm,
  flameLevel,
  forcedShareFlamesVariant,
  shareFlameTier,
} from "./shareFlamesTest";

afterEach(() => localStorage.clear());

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
  it("names the tier the words' average score earns, from Extremely Rare up", () => {
    expect(shareFlameTier([scoring(8.2), scoring(8.6)], DATE)).toBe("Extremely Rare");
    expect(shareFlameTier([scoring(8.8), scoring(9.4)], DATE)).toBe("Elusive");
    expect(shareFlameTier([scoring(9.2), scoring(10)], DATE)).toBe("Mythic");
    expect(shareFlameTier([scoring(9.9), scoring(10)], DATE)).toBe("Legend");
  });

  it("goes by the average, not the best word", () => {
    expect(shareFlameTier([scoring(10), scoring(5)], DATE)).toBeNull();
    expect(shareFlameTier([scoring(10), scoring(6.2)], DATE)).toBe("Extremely Rare");
  });

  it("does not burn below Extremely Rare, or with no words", () => {
    expect(shareFlameTier([scoring(7.8)], DATE)).toBeNull();
    expect(shareFlameTier([], DATE)).toBeNull();
  });

  it("does not burn on a puzzle whose tiers a score cannot name", () => {
    expect(shareFlameTier([scoring(10)], "2026-08-01")).toBeNull();
  });
});

describe("flameLevel", () => {
  it("burns larger each tier up", () => {
    expect(flameLevel("Extremely Rare")).toBe(1);
    expect(flameLevel("Elusive")).toBe(2);
    expect(flameLevel("Mythic")).toBe(3);
    expect(flameLevel("Legend")).toBe(4);
  });
});

describe("assignShareFlamesArm", () => {
  it("splits players 50/50", () => {
    expect(assignShareFlamesArm(() => 0.49)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignShareFlamesArm(() => 0.5)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignShareFlamesArm(() => 0.9);
    expect(assignShareFlamesArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
    expect(drawnShareFlamesArm()).toBe("hidden");
  });

  it("reads no arm before the draw", () => {
    expect(drawnShareFlamesArm()).toBeNull();
  });
});

describe("forcedShareFlamesVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedShareFlamesVariant("?share-flames=shown")).toBe("shown");
    expect(forcedShareFlamesVariant("?share-flames=hidden")).toBe("hidden");
    expect(forcedShareFlamesVariant("?share-flames=maybe")).toBeNull();
  });

  it("forces NorthernBear87 to shown unless the query string says otherwise", () => {
    // An id whose handle is NorthernBear87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-3185178" }));
    expect(forcedShareFlamesVariant("")).toBe("shown");
    expect(forcedShareFlamesVariant("?share-flames=hidden")).toBe("hidden");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedShareFlamesVariant("")).toBeNull();
  });
});
