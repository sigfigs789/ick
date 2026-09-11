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

// The pre-launch stretch (days 1-37, 2026-07-01 .. 2026-08-06) was dealt before
// the game had an audience: every accepted answer recorded against those days
// arrived in a single archive sweep on 2026-08-31, and they hold the richest
// boards in the rotation. They were returned to the unplayed tail for a second
// outing, which is the one sanctioned way a drop repeats -- so the rule that
// every *other* drop is dealt once is pinned here, along with the shape of the
// repeat itself.
describe("recycled drops", () => {
  const FIRST_RECYCLED_DAY = "2026-09-11";
  const recycled = new Set<string>(dropData.recycledDrops);

  it("recycles only drops that were already dealt", () => {
    const dealt = new Set(dropData.lockedDrops);
    expect([...recycled].filter((drop) => !dealt.has(drop))).toEqual([]);
  });

  it("deals each recycled drop exactly twice, the repeat in the future", () => {
    const firstRecycledIndex = dropData.drops.indexOf(
      dropForDate(FIRST_RECYCLED_DAY)
    );
    for (const drop of recycled) {
      const days = dropData.drops.flatMap((d, i) => (d === drop ? [i] : []));
      expect(days).toHaveLength(2);
      expect(days[0]).toBeLessThan(dropData.lockedDrops.length);
      expect(days[1]).toBeGreaterThanOrEqual(firstRecycledIndex);
    }
  });

  it("deals every other drop exactly once", () => {
    const counts = new Map<string, number>();
    for (const drop of dropData.drops) {
      counts.set(drop, (counts.get(drop) ?? 0) + 1);
    }
    const repeated = [...counts]
      .filter(([, n]) => n > 1)
      .map(([drop]) => drop)
      .sort();
    // STR is the one repeat that predates the recycling: it was seeded a second
    // time on day 44, back when day 44 was still in the future.
    expect(repeated).toEqual([...recycled, "STR"].sort());
  });

  it("keeps the affixes that were already dealt out of the tail", () => {
    // ING, RE and IVE are affixes exempt from affixDrops only because they had
    // already been published. Recycling one would deal an affix on purpose.
    for (const affix of ["ING", "RE", "IVE"]) {
      expect(recycled.has(affix)).toBe(false);
      expect(dropData.drops.lastIndexOf(affix)).toBeLessThan(
        dropData.lockedDrops.length
      );
    }
  });
});
