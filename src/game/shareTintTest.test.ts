import { afterEach, describe, expect, it } from "vitest";
import { rarityScore } from "./dictionary";
import { assignShareTintArm, drawnShareTintArm, forcedShareTintVariant, shareTinted } from "./shareTintTest";

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

describe("shareTinted", () => {
  it("tints only while the average is Extremely Rare", () => {
    expect(shareTinted([scoring(8.2), scoring(8.6)], DATE)).toBe(true);
    expect(shareTinted([scoring(10), scoring(5)], DATE)).toBe(false);
    expect(shareTinted([scoring(8.8), scoring(9.4)], DATE)).toBe(false);
  });

  it("does not tint with no words, or on a puzzle whose tiers a score cannot name", () => {
    expect(shareTinted([], DATE)).toBe(false);
    expect(shareTinted([scoring(8.4)], "2026-08-01")).toBe(false);
  });
});

describe("assignShareTintArm", () => {
  it("splits players 20/80", () => {
    expect(assignShareTintArm(() => 0.19)).toEqual({ variant: "shown", fresh: true });
    localStorage.clear();
    expect(assignShareTintArm(() => 0.2)).toEqual({ variant: "hidden", fresh: true });
  });

  it("keeps the first draw for good", () => {
    assignShareTintArm(() => 0.9);
    expect(assignShareTintArm(() => 0)).toEqual({ variant: "hidden", fresh: false });
    expect(drawnShareTintArm()).toBe("hidden");
  });

  it("reads no arm before the draw", () => {
    expect(drawnShareTintArm()).toBeNull();
  });
});

describe("forcedShareTintVariant", () => {
  it("takes either arm from the query string", () => {
    expect(forcedShareTintVariant("?share-tint=shown")).toBe("shown");
    expect(forcedShareTintVariant("?share-tint=hidden")).toBe("hidden");
    expect(forcedShareTintVariant("?share-tint=maybe")).toBeNull();
  });

  it("forces FleetAspen87 to shown unless the query string says otherwise", () => {
    // An id whose handle is FleetAspen87 (see game/handle.ts).
    localStorage.setItem("ick:player", JSON.stringify({ id: "tester-10338031" }));
    expect(forcedShareTintVariant("")).toBe("shown");
    expect(forcedShareTintVariant("?share-tint=hidden")).toBe("hidden");
    localStorage.setItem("ick:player", JSON.stringify({ id: "someone-else" }));
    expect(forcedShareTintVariant("")).toBeNull();
  });
});
