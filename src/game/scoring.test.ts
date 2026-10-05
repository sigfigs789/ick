import { describe, it, expect } from "vitest";
import {
  rarityFor,
  rarityScore,
  rarityForZipf,
  formatRarityScore,
  formatScore,
  formatTotal,
  totalRarityScore,
  unattestedZipf,
} from "./dictionary";

// Expected values are hardcoded (not recomputed via the functions under test)
// so a regression in the scoring math or the legacy dataset is actually caught.
const BEFORE = "2026-08-14"; // last day on the legacy system
const ON = "2026-08-15"; // the only day on the original two-band system (9.5 ceiling, no Legend)
const WIDE = "2026-08-16"; // first day on the latest widened system (9.9 ceiling + Legend)
const AFTER = "2027-03-01";

describe("date-gated scoring", () => {
  it("uses the legacy system before 2026-08-15 and a two-band system on/after", () => {
    // "autecism" is attested by no corpus. The legacy system floored such words
    // flat to Zipf 1.4 (Extremely Rare, score 9.4); every two-band system ranks
    // it as the single rarest word with a perfect 10.0.
    const legacy = rarityFor("autecism", BEFORE)!;
    expect(legacy).toEqual({ rarity: "Extremely Rare", zipf: 1.4 });
    expect(rarityScore(legacy.zipf, BEFORE)).toBe(9.4);

    // 2026-08-15: the deep-tail library is a single Mythic top rank (no Legend).
    const current = rarityFor("autecism", ON)!;
    expect(current.rarity).toBe("Mythic");
    expect(rarityScore(current.zipf, ON)).toBe(10);
  });

  it("adds the Legend tier only from 2026-08-16", () => {
    // Same word and same 10.0 score, but the deep-tail top rank is Mythic on
    // 2026-08-15 and Legend from 2026-08-16 (and for undated/newest puzzles).
    expect(rarityFor("autecism", ON)!.rarity).toBe("Mythic");
    expect(rarityFor("autecism", WIDE)!.rarity).toBe("Legend");
    expect(rarityFor("autecism", AFTER)!.rarity).toBe("Legend");
    expect(rarityFor("autecism")!.rarity).toBe("Legend");
  });

  it("defaults to the latest system when no date is given", () => {
    const info = rarityFor("autecism")!;
    expect(info.rarity).toBe("Legend");
    expect(rarityScore(info.zipf)).toBe(10);
  });

  it("changes the Zipf-to-score conversion between 2026-08-15 and 2026-08-16", () => {
    // The measured band widened from 0..9.5 to 0..9.9, so the rarest measured
    // word (Zipf 1) tops out higher and every measured word rescales up. The
    // latest system also carries two decimals where 2026-08-15 kept one.
    expect(rarityScore(1, ON)).toBe(9.5);
    expect(rarityScore(1, WIDE)).toBe(9.9);
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2); // one decimal
    expect(rarityScore(rarityFor("cat", WIDE)!.zipf, WIDE)).toBe(4.34); // two decimals
  });

  it("rescales even measured words across the legacy cutover", () => {
    // "cat" is measured under every system; only the scale changes.
    expect(rarityScore(rarityFor("cat", BEFORE)!.zipf, BEFORE)).toBe(4.3); // legacy
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2); // 2026-08-15
  });
});

describe("two-band rarity score (current system)", () => {
  it("caps measured words (Zipf >= 1) at 9.9 and anchors the most common at 0", () => {
    expect(rarityScore(1)).toBe(9.9); // rarest measured word
    expect(rarityScore(7.73)).toBe(0); // the dictionary's most common word
    expect(rarityFor("cat")!.rarity).not.toBe("Mythic");
  });

  it("puts Zipf 0..1 in the 9.9..10 band and clamps everything at/below 0 to a flat 10", () => {
    expect(rarityScore(0.5)).toBe(9.95); // mid deep-tail -> between the anchors
    expect(rarityScore(0)).toBe(10); // the clamp floor
    expect(rarityScore(-0.31)).toBe(10); // below the floor -> clamped, not lower
    expect(rarityScore(-1.57)).toBe(10); // the unattested sentinel, same 10
  });
});

describe("the unattested sentinel across every system", () => {
  // A live-validated word carries the current data's sentinel Zipf on whatever
  // date it is played, including an archived legacy puzzle whose own scale stops
  // at Zipf 1.0. Every system has to land it at a perfect 10 rather than let it
  // run off the top of the scale -- it scored 13.8 on legacy dates.
  it("scores a flat 10 on every date, legacy puzzles included", () => {
    const sentinel = unattestedZipf();
    expect(sentinel).toBe(-1.57);
    expect(rarityScore(sentinel, BEFORE)).toBe(10);
    expect(rarityScore(sentinel, ON)).toBe(10);
    expect(rarityScore(sentinel, WIDE)).toBe(10);
    expect(rarityScore(sentinel, AFTER)).toBe(10);
    expect(rarityScore(sentinel)).toBe(10);
  });

  it("never scores any Zipf above 10 under the legacy system", () => {
    expect(rarityScore(1, BEFORE)).toBe(10); // the legacy scale's own floor
    expect(rarityScore(0, BEFORE)).toBe(10); // below it -> clamped, not higher
    expect(rarityScore(-5, BEFORE)).toBe(10); // far below -> still 10
    expect(formatScore(rarityScore(unattestedZipf(), BEFORE), BEFORE)).toBe("10.0");
  });

  it("leaves the measured legacy words untouched", () => {
    // The clamp only bites below Zipf 1.0 and the legacy data's minimum is
    // exactly 1.0, so no archived puzzle's scores move.
    expect(rarityScore(rarityFor("cat", BEFORE)!.zipf, BEFORE)).toBe(4.3);
    expect(rarityScore(rarityFor("autecism", BEFORE)!.zipf, BEFORE)).toBe(9.4);
  });
});

describe("score formatting", () => {
  it("shows two decimals for Mythic and Legend, one decimal below", () => {
    expect(formatRarityScore(0.5)).toBe("9.95"); // Legend (deep tail) -> two decimals
    expect(formatRarityScore(rarityFor("aardwolf")!.zipf)).toBe("9.75"); // Mythic -> two decimals
    expect(formatRarityScore(rarityFor("cat")!.zipf)).toBe("4.7"); // below Mythic -> one decimal
    expect(formatScore(9.9)).toBe("9.90");
    expect(formatScore(4.3)).toBe("4.3");
  });

  it("always shows one decimal under the legacy system", () => {
    expect(formatRarityScore(rarityFor("autecism", BEFORE)!.zipf, BEFORE)).toBe("9.4");
    expect(formatScore(9.4, BEFORE)).toBe("9.4");
  });

  it("shows a total's two decimals whatever band it would fall in", () => {
    // A total has no bands: every total clears any single word's ceiling, so the
    // question `formatScore` answers has no answer for one.
    expect(formatTotal(39.95)).toBe("39.95");
    expect(formatTotal(40)).toBe("40.00");
    expect(formatTotal(2.5)).toBe("2.50");
  });
});

describe("a puzzle's total", () => {
  it("keeps the hundredths its words were priced in", () => {
    // Three perfect deep-tail finds and one a nickel under -- 39.95, which
    // rounded to tenths landed on the half and became a flat 40.
    const words = [{ zipf: -1.57 }, { zipf: -1.57 }, { zipf: 0.53 }, { zipf: -1.57 }];
    expect(words.map((w) => rarityScore(w.zipf, WIDE))).toEqual([10, 10, 9.95, 10]);
    expect(totalRarityScore(words, WIDE)).toBe(39.95);
  });

  it("rounds the float tail off the sum rather than carrying it to the board", () => {
    // Four words at 9.95 is 39.800000000000004 added up in binary.
    expect(totalRarityScore([{ zipf: 0.53 }, { zipf: 0.53 }, { zipf: 0.53 }, { zipf: 0.53 }], WIDE)).toBe(
      39.8
    );
  });
});

describe("the 0.3 lift (from 2026-10-11)", () => {
  const BEFORE_LIFT = "2026-10-10";
  const LIFT = "2026-10-11";
  // The Zipf that showed exactly 8.7 the day before the lift.
  const zipfAt87 = (() => {
    let lo = 1;
    let hi = 3;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (rarityScore(mid, BEFORE_LIFT) >= 8.7) lo = mid;
      else hi = mid;
    }
    return lo;
  })();

  it("shows a word that was 8.7 as 9.0 Elusive", () => {
    expect(rarityScore(zipfAt87, BEFORE_LIFT)).toBe(8.7);
    expect(rarityScore(zipfAt87, LIFT)).toBe(9);
    expect(rarityForZipf(zipfAt87, BEFORE_LIFT)).toBe("Extremely Rare");
    expect(rarityForZipf(zipfAt87, LIFT)).toBe("Elusive");
  });

  it("adds 0.3 below the knee", () => {
    for (const zipf of [2.5, 3.5, 4.5]) {
      expect(rarityScore(zipf, LIFT)).toBeCloseTo(rarityScore(zipf, BEFORE_LIFT) + 0.3, 5);
    }
  });

  it("lifts Freeform's labels as well as Standard's", () => {
    for (const mode of ["standard", "freeform"] as const) {
      expect(rarityForZipf(zipfAt87, BEFORE_LIFT, mode)).toBe("Extremely Rare");
      expect(rarityForZipf(zipfAt87, LIFT, mode)).toBe("Elusive");
    }
  });

  it("never lowers a score, keeps the top pinned, and makes no measured Legend", () => {
    for (let z = 1; z <= 7.5; z += 0.01) {
      const before = rarityScore(z, BEFORE_LIFT);
      const after = rarityScore(z, LIFT);
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeLessThanOrEqual(9.9);
      if (before < 9.9) expect(rarityForZipf(z, LIFT)).not.toBe("Legend");
    }
    // The deep tail and the unattested sentinel do not move.
    expect(rarityScore(0.5, LIFT)).toBe(rarityScore(0.5, BEFORE_LIFT));
    expect(rarityScore(unattestedZipf(), LIFT)).toBe(10);
  });

  it("leaves puzzles before the lift as they were played", () => {
    expect(rarityScore(zipfAt87, "2026-10-04")).toBe(8.7);
  });
});
