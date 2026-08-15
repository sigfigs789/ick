import { describe, it, expect } from "vitest";
import { rarityFor, rarityScore, formatRarityScore, formatScore } from "./dictionary";

// Expected values are hardcoded (not recomputed via the functions under test)
// so a regression in the scoring math or the legacy dataset is actually caught.
const BEFORE = "2026-08-14"; // last day on the legacy system
const ON = "2026-08-15"; // first day on the two-band 9.5 system
const WIDE = "2026-08-16"; // first day on the widened 9.9 band
const AFTER = "2027-03-01";

describe("date-gated scoring", () => {
  it("uses the legacy system before 2026-08-15 and the new system on/after", () => {
    // "autecism" is attested by no corpus. The legacy system floored such
    // words flat to Zipf 1.4 (Extremely Rare, score 9.4); the new system ranks
    // it as the single rarest word (Mythic, a perfect 10.0).
    const legacy = rarityFor("autecism", BEFORE)!;
    expect(legacy).toEqual({ rarity: "Extremely Rare", zipf: 1.4 });
    expect(rarityScore(legacy.zipf, BEFORE)).toBe(9.4);

    const current = rarityFor("autecism", ON)!;
    expect(current.rarity).toBe("Mythic");
    expect(rarityScore(current.zipf, ON)).toBe(10);
  });

  it("defaults to the newest system when no date is given", () => {
    const info = rarityFor("autecism")!;
    expect(info.rarity).toBe("Mythic");
    expect(rarityScore(info.zipf)).toBe(10);
  });

  it("keeps later dates on the newest system", () => {
    expect(rarityFor("autecism", AFTER)!.rarity).toBe("Mythic");
  });

  it("rescales even measured words across the 2026-08-15 cutover", () => {
    // "cat" is measured under both systems; only the scale changes (the legacy
    // 1.0 floor vs the new 0 floor), so its score shifts slightly.
    expect(rarityScore(rarityFor("cat", BEFORE)!.zipf, BEFORE)).toBe(4.3);
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2);
  });

  it("widens the measured band from 9.5 to 9.9 on 2026-08-16", () => {
    // The rarest measured word (Zipf 1) tops out the measured band, which grew
    // from 9.5 to 9.9; every measured word rescales up proportionally.
    expect(rarityScore(1, ON)).toBe(9.5);
    expect(rarityScore(1, WIDE)).toBe(9.9);
    expect(rarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe(4.2);
    expect(rarityScore(rarityFor("cat", WIDE)!.zipf, WIDE)).toBe(4.3);
  });
});

describe("two-band rarity score (newest system, 9.9 band)", () => {
  it("caps measured words (Zipf >= 1) at 9.9 and anchors the most common at 0", () => {
    expect(rarityScore(1)).toBe(9.9); // rarest measured word
    expect(rarityScore(7.73)).toBe(0); // the dictionary's most common word
    expect(rarityFor("cat")!.rarity).not.toBe("Mythic");
  });

  it("puts the deep tail (Zipf < 1) in the 9.9..10 band, reserving 10 for unattested", () => {
    // Attested by Google Books but vanishingly rare -> just below the top.
    const attested = rarityFor("septendecillion")!;
    expect(attested.rarity).toBe("Mythic");
    const attestedScore = rarityScore(attested.zipf);
    expect(attestedScore).toBeGreaterThan(9.9);
    expect(attestedScore).toBeLessThan(10);

    // Attested by no corpus -> the only words that reach a perfect 10.
    expect(rarityScore(rarityFor("autecism")!.zipf)).toBe(10);
  });
});

describe("two-band rarity score (2026-08-15 system, 9.5 band)", () => {
  it("caps measured words at 9.5 and keeps the deep tail in the 9.5..10 band", () => {
    expect(rarityScore(1, ON)).toBe(9.5); // rarest measured word
    const attested = rarityScore(rarityFor("septendecillion", ON)!.zipf, ON);
    expect(attested).toBeGreaterThan(9.5);
    expect(attested).toBeLessThan(10);
    expect(rarityScore(rarityFor("autecism", ON)!.zipf, ON)).toBe(10);
  });
});

describe("score formatting", () => {
  it("shows two decimals for deep-tail scores and one for measured (newest system)", () => {
    expect(formatRarityScore(rarityFor("septendecillion")!.zipf)).toBe("9.95");
    expect(formatRarityScore(rarityFor("cat")!.zipf)).toBe("4.3");
    expect(formatScore(9.95)).toBe("9.95");
    expect(formatScore(4.3)).toBe("4.3");
  });

  it("keeps the 9.5-band formatting on 2026-08-15", () => {
    expect(formatRarityScore(rarityFor("septendecillion", ON)!.zipf, ON)).toBe("9.75");
    expect(formatRarityScore(rarityFor("cat", ON)!.zipf, ON)).toBe("4.2");
  });

  it("always shows one decimal under the legacy system", () => {
    expect(formatRarityScore(rarityFor("autecism", BEFORE)!.zipf, BEFORE)).toBe("9.4");
    expect(formatScore(9.4, BEFORE)).toBe("9.4");
  });
});
