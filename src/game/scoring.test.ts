import { describe, it, expect } from "vitest";
import { rarityFor, rarityScore, formatRarityScore, formatScore } from "./dictionary";

// Expected values are hardcoded (not recomputed via the functions under test)
// so a regression in the scoring math or the legacy dataset is actually caught.
const BEFORE = "2026-08-14"; // last day on the legacy system
const ON = "2026-08-15"; // the only day on the original two-band system (9.5 ceiling)
const WIDE = "2026-08-16"; // first day on the widened band (9.8 ceiling)
const AFTER = "2027-03-01";

describe("date-gated scoring", () => {
  it("uses the legacy system before 2026-08-15 and the new system on/after", () => {
    // "autecism" is attested by no corpus. The legacy system floored such
    // words flat to Zipf 1.4 (Extremely Rare, score 9.4); the new system ranks
    // it as the single rarest word (Legend -- the deep-tail top rank -- with a
    // perfect 10.0).
    const legacy = rarityFor("autecism", BEFORE)!;
    expect(legacy).toEqual({ rarity: "Extremely Rare", zipf: 1.4 });
    expect(rarityScore(legacy.zipf, BEFORE)).toBe(9.4);

    const current = rarityFor("autecism", ON)!;
    expect(current.rarity).toBe("Legend");
    expect(rarityScore(current.zipf, ON)).toBe(10);
  });

  it("defaults to the new system when no date is given", () => {
    const info = rarityFor("autecism")!;
    expect(info.rarity).toBe("Legend");
    expect(rarityScore(info.zipf)).toBe(10);
  });

  it("keeps later dates on the new system", () => {
    expect(rarityFor("autecism", AFTER)!.rarity).toBe("Legend");
  });

  it("rescales even measured words across the cutover", () => {
    // "cat" is measured under every system; only the scale changes (the legacy
    // 1.0 floor vs the new 0 floor), so its score shifts slightly.
    expect(rarityScore(rarityFor("cat", BEFORE)!.zipf, BEFORE)).toBe(4.3);
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2);
  });

  it("widens the measured band from 9.5 to 9.8 on 2026-08-16", () => {
    // The rarest measured word (Zipf 1) tops out the measured band, which grew
    // from 9.5 to 9.8; every measured word rescales up proportionally.
    expect(rarityScore(1, ON)).toBe(9.5);
    expect(rarityScore(1, WIDE)).toBe(9.8);
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2);
    expect(rarityScore(rarityFor("cat", WIDE)!.zipf, WIDE)).toBe(4.3);
  });
});

describe("two-band rarity score (current system)", () => {
  it("caps measured words (Zipf >= 1) at 9.8 and anchors the most common at 0", () => {
    expect(rarityScore(1)).toBe(9.8); // rarest measured word
    expect(rarityScore(7.73)).toBe(0); // the dictionary's most common word
    expect(rarityFor("cat")!.rarity).not.toBe("Mythic");
  });

  it("puts Zipf 0..1 in the 9.8..10 band and clamps everything at/below 0 to a flat 10", () => {
    expect(rarityScore(0.5)).toBe(9.9); // mid deep-tail -> between the anchors
    expect(rarityScore(0)).toBe(10); // the clamp floor
    expect(rarityScore(-0.31)).toBe(10); // below the floor -> clamped, not lower
    expect(rarityScore(-1.57)).toBe(10); // the unattested sentinel, same 10
  });
});

describe("score formatting", () => {
  it("shows two decimals for deep-tail scores and one for measured (current system)", () => {
    expect(formatRarityScore(0.5)).toBe("9.90"); // deep tail -> two decimals
    expect(formatRarityScore(rarityFor("cat")!.zipf)).toBe("4.3"); // measured -> one
    expect(formatScore(9.9)).toBe("9.90");
    expect(formatScore(4.3)).toBe("4.3");
  });

  it("always shows one decimal under the legacy system", () => {
    expect(formatRarityScore(rarityFor("autecism", BEFORE)!.zipf, BEFORE)).toBe("9.4");
    expect(formatScore(9.4, BEFORE)).toBe("9.4");
  });
});
