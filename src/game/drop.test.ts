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
