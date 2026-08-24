import { describe, expect, it } from "vitest";
import dropData from "../data/drops.json";
import { dropForDate } from "./drop";

// Published dates are immutable; the expanded rotation begins afterward.
const PUBLISHED_DROPS = [
  "AT", "FL", "STR", "LT", "IG", "EA", "EP", "RM", "GHT", "IVE",
  "EE", "EL", "AS", "FR", "AC", "OT", "EV", "OUT", "ING", "IT",
  "SM", "RE", "GR", "UG", "IL", "PLE", "AL", "ER", "NK", "SC",
  "TR", "RK", "OO", "RN", "AW", "AP", "US", "EF", "OM", "EX",
  "SP", "RT", "END",
];

describe("dropForDate", () => {
  it("is deterministic for the same date", () => {
    expect(dropForDate("2024-06-01")).toBe(dropForDate("2024-06-01"));
  });

  it("returns the first drop on the epoch date", () => {
    expect(dropForDate(dropData.epoch)).toBe(dropData.drops[0]);
  });

  it("cycles back to the same drop after a full rotation", () => {
    const n = dropData.drops.length;
    const later = new Date(`${dropData.epoch}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + n);
    const laterStr = later.toISOString().slice(0, 10);
    expect(dropForDate(laterStr)).toBe(dropForDate(dropData.epoch));
  });

  it("only ever returns drops from the curated list", () => {
    expect(dropData.drops).toContain(dropForDate("2025-03-17"));
  });

  it("preserves every published day before the mixed rotation", () => {
    expect(dropData.lockedDrops).toEqual(PUBLISHED_DROPS);
    expect(dropData.drops.slice(0, PUBLISHED_DROPS.length)).toEqual(PUBLISHED_DROPS);

    const date = new Date(`${dropData.epoch}T00:00:00Z`);
    for (const drop of PUBLISHED_DROPS) {
      expect(dropForDate(date.toISOString().slice(0, 10))).toBe(drop);
      date.setUTCDate(date.getUTCDate() + 1);
    }

    expect(dropForDate(date.toISOString().slice(0, 10))).toBe("STR");
  });
});

// The parked tiers are held out of the rotation, not retired -- they exist so a
// challenge mode can pick them up later. Nothing enforces that at the type
// level, and both scripts/select-drops.py and a hand-edit can rewrite drops.json,
// so the invariant that makes the tiers mean anything is pinned here: a parked
// drop is never dealt, and never sits in both tiers at once.
describe("parked drop tiers", () => {
  const parked = [
    ...dropData.challengingDrops,
    ...dropData.hardDrops,
    ...dropData.retiredDrops,
  ];

  it("never deals a parked drop", () => {
    const rotation = new Set(dropData.drops);
    expect(parked.filter((drop) => rotation.has(drop))).toEqual([]);
  });

  it("keeps the tiers disjoint, with no drop listed twice", () => {
    expect(new Set(parked).size).toBe(parked.length);
  });

  it("leaves every published day dealable", () => {
    expect(parked.filter((drop) => dropData.lockedDrops.includes(drop))).toEqual([]);
  });
});
