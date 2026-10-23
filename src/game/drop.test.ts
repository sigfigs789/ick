import { describe, expect, it } from "vitest";
import dropData from "../data/drops.json";
import { addDays, daysSinceEpoch } from "./date";
import { dropForDate } from "./drop";
import difficultySource from "../../scripts/drop-difficulty.json?raw";

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
    ...dropData.affixDrops,
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

// A drop that is itself a prefix or suffix ("ED", "UN", "ISH") makes the puzzle
// mechanical: append the drop to any word and you have an answer, so the whole
// class is parked in affixDrops. The rule arrived mid-rotation, so the affixes
// already dealt -- "ING", "RE", "IVE", and today's "PRE" -- keep their published
// days and are not listed as parked; only the undealt ones were pulled.
describe("affix drops", () => {
  it("keeps every day up to the rule's first day exactly as it was dealt", () => {
    // 2026-09-06 is the first day the removal was allowed to move; the drops
    // before it are played or live, and are immutable.
    expect(dropForDate("2026-09-04")).toBe("PRE");
    expect(dropForDate("2026-09-05")).toBe("LIS");
    expect(dropForDate("2026-09-06")).toBe(dropData.drops[67]);
  });
});

// From 2026-11-03 the two busiest days of the week, Tuesday and Thursday, are
// dealt easy drops (scripts/reorder-drops.py, EASY_WEEKDAYS). Easy is the
// measure the difficulty tiers use, the Rare+ answers in
// scripts/drop-difficulty.json, read against the other drops of the same
// length still to be dealt, since the sort keeps the 2-letter/3-letter cadence.
// Re-seeded drops keep the day they were placed on, so they are not held to it.
describe("busy-day drops", () => {
  const rarePlus: Record<string, number> = JSON.parse(difficultySource).rarePlus;
  const from = daysSinceEpoch("2026-11-02", dropData.epoch);
  const rest = dropData.drops.slice(from);
  const median = (length: number) => {
    const counts = rest.filter((d) => d.length === length).map((d) => rarePlus[d]).sort((a, b) => a - b);
    return counts[Math.floor(counts.length / 2)];
  };
  const medians: Record<number, number> = { 2: median(2), 3: median(3) };

  it("deals every Tuesday and Thursday a drop at least as rich as the median of its length", () => {
    const poor: string[] = [];
    for (let i = from; i < dropData.drops.length; i++) {
      const date = addDays(dropData.epoch, i);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const drop = dropData.drops[i];
      if ((weekday !== 2 && weekday !== 4) || dropData.seededDrops.includes(drop)) continue;
      if (rarePlus[drop] < medians[drop.length]) poor.push(`${date} ${drop} ${rarePlus[drop]}`);
    }
    expect(poor).toEqual([]);
  });
});
