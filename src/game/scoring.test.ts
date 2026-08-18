import { describe, it, expect } from "vitest";
import {
  rarityFor,
  rarityScore,
  formatRarityScore,
  formatScore,
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
    expect(formatRarityScore(rarityFor("aardwolf")!.zipf)).toBe("9.74"); // Mythic -> two decimals
    expect(formatRarityScore(rarityFor("cat")!.zipf)).toBe("4.3"); // below Mythic -> one decimal
    expect(formatScore(9.9)).toBe("9.90");
    expect(formatScore(4.3)).toBe("4.3");
  });

  it("always shows one decimal under the legacy system", () => {
    expect(formatRarityScore(rarityFor("autecism", BEFORE)!.zipf, BEFORE)).toBe("9.4");
    expect(formatScore(9.4, BEFORE)).toBe("9.4");
  });
});
