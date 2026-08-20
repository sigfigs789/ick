import { describe, expect, it } from "vitest";
// @ts-expect-error -- Node builtin; this app has no @types/node, but the module
// is available at runtime under vitest (Node).
import { readFileSync } from "node:fs";
import {
  formatRarityScore,
  formatScore,
  rarityFor,
  rarityForZipf,
  rarityScore,
  RARITY_ORDER,
  topRankForScore,
  usesRetunedTiers,
} from "./dictionary";
import { RARITY_SYMBOL, raritySymbol } from "./share";
import type { Rarity } from "./types";

// Minimal ambient for the Node global (this app doesn't depend on @types/node).
declare const process: { cwd(): string };

// Every ranking, a representative dictionary word, its expected label, and how
// many decimals its score should show (two for the top two ranks, one for the
// rest). Words are pinned so a scoring/label regression is actually caught.
const RANKINGS: ReadonlyArray<[word: string, rarity: Rarity, decimals: number]> = [
  ["the", "Very Common", 1],
  ["castle", "Common", 1],
  ["chateau", "Uncommon", 1],
  ["awol", "Rare", 1],
  ["okapi", "Extremely Rare", 1],
  ["borborygmus", "Epic", 1],
  ["aardwolf", "Mythic", 2],
  ["autecism", "Legend", 2],
];

describe("ranking labels and display precision", () => {
  it.each(RANKINGS)("labels %s as %s", (word, rarity) => {
    expect(rarityFor(word)?.rarity).toBe(rarity);
  });

  it.each(RANKINGS)("shows %s (%s) with the right number of decimals", (word, _rarity, decimals) => {
    const info = rarityFor(word)!;
    const shown = formatRarityScore(info.zipf);
    expect(shown.split(".")[1]?.length ?? 0).toBe(decimals);
  });

  it("uses two decimals only for Mythic and Legend", () => {
    for (const [word, rarity] of RANKINGS) {
      const info = rarityFor(word)!;
      const decimals = formatRarityScore(info.zipf).split(".")[1]?.length ?? 0;
      const isTopRank = rarity === "Mythic" || rarity === "Legend";
      expect(decimals).toBe(isTopRank ? 2 : 1);
    }
  });
});

describe("top-rank score cutoffs", () => {
  it("keeps 9.85-9.89 in Mythic and starts Legend at 9.9", () => {
    expect(topRankForScore(9.85)).toBe("Mythic"); // stays Mythic, not Legend
    expect(topRankForScore(9.89)).toBe("Mythic");
    expect(topRankForScore(9.9)).toBe("Legend");
    expect(topRankForScore(10)).toBe("Legend");
  });

  it("flips to Legend only when a hair under rounds up to 9.90", () => {
    expect(topRankForScore(9.895)).toBe("Legend"); // rounds to 9.90 -> Legend
    expect(topRankForScore(9.894)).toBe("Mythic"); // rounds to 9.89 -> stays Mythic
  });

  it("starts Mythic wherever the score displays as 9.5 (raw >= 9.45)", () => {
    expect(topRankForScore(9.5)).toBe("Mythic");
    expect(topRankForScore(9.495)).toBe("Mythic"); // shows 9.5 -> Mythic
    expect(topRankForScore(9.48)).toBe("Mythic"); // rounds to 9.5 -> Mythic
    expect(topRankForScore(9.46)).toBe("Mythic"); // rounds to 9.5 -> Mythic
    expect(topRankForScore(9.45)).toBe("Mythic"); // 9.45 rounds up to 9.5
  });

  it("leaves scores that display below 9.5 (raw < 9.45) out of the top ranks", () => {
    expect(topRankForScore(9.44)).toBeUndefined(); // rounds to 9.4 -> below Mythic
    expect(topRankForScore(4.3)).toBeUndefined();
    expect(topRankForScore(0)).toBeUndefined();
  });
});

describe("rank ladder across the latest system", () => {
  // A representative Zipf from each measured band -- all below the top ranks --
  // to confirm the middle of the run lands in the right label at the right score.
  const MEASURED_LADDER: ReadonlyArray<[zipf: number, rarity: Rarity]> = [
    [7.7, "Very Common"],
    [5.6, "Very Common"],
    [4.5, "Common"],
    [3.5, "Uncommon"],
    [2.5, "Rare"],
    [1.8, "Extremely Rare"],
    [1.45, "Epic"],
  ];

  it.each(MEASURED_LADDER)("Zipf %s ranks as %s, below the top tiers", (zipf, rarity) => {
    expect(rarityForZipf(zipf)).toBe(rarity);
    expect(rarityScore(zipf)).toBeLessThan(9.5);
  });

  it("ranks mid-run top scores by the fixed cutoffs (9.63 Mythic, 9.95 Legend)", () => {
    expect(topRankForScore(9.63)).toBe("Mythic");
    expect(topRankForScore(9.75)).toBe("Mythic");
    expect(topRankForScore(9.95)).toBe("Legend");
  });

  it("scores a Zipf of 1.68 at 8.9 and ranks it Extremely Rare", () => {
    expect(rarityScore(1.68)).toBe(8.9);
    expect(rarityForZipf(1.68)).toBe("Extremely Rare");
  });

  it("scores a Zipf of 1.18 in the Mythic band", () => {
    const score = rarityScore(1.18);
    expect(score).toBeGreaterThanOrEqual(9.5);
    expect(score).toBeLessThan(9.9);
    expect(rarityForZipf(1.18)).toBe("Mythic");
  });
});

describe("narrow measured bands (from 2026-08-21)", () => {
  const BEFORE = "2026-08-20"; // last day on the original bands
  const ON = "2026-08-21"; // first day on the retuned bands

  // Each band's floor and the Zipf a hair beneath it, so a cutoff that drifts
  // is caught in both directions.
  const EDGES: ReadonlyArray<[zipf: number, rarity: Rarity]> = [
    [4.85, "Very Common"],
    [4.84, "Common"],
    [3.9, "Common"],
    [3.89, "Uncommon"],
    [3.15, "Uncommon"],
    [3.14, "Rare"],
    [2.13, "Rare"],
    [2.12, "Extremely Rare"],
    [1.59, "Extremely Rare"],
    [1.58, "Epic"],
  ];

  it.each(EDGES)("Zipf %s sits in %s", (zipf, rarity) => {
    expect(rarityForZipf(zipf, ON)).toBe(rarity);
    expect(rarityForZipf(zipf)).toBe(rarity); // undefined date = newest system
  });

  it("keeps archived puzzles on the bands they were played with", () => {
    // Zipf 2.22 ("gorgonzola") was Extremely Rare under the original bands and
    // is Rare under the retuned ones -- the clearest single word for the shift.
    expect(rarityForZipf(2.22, BEFORE)).toBe("Extremely Rare");
    expect(rarityForZipf(2.22, ON)).toBe("Rare");
    // Epic exists only under the retuned bands.
    expect(rarityForZipf(1.4, BEFORE)).toBe("Extremely Rare");
    expect(rarityForZipf(1.4, ON)).toBe("Epic");
  });

  it("retires Quotidian without disturbing the puzzles that had it", () => {
    // The bottom tier was folded into Very Common, but only forwards: an
    // archived puzzle's everyday word still reads Quotidian.
    expect(rarityForZipf(7.7, BEFORE)).toBe("Quotidian");
    expect(rarityForZipf(7.7, ON)).toBe("Very Common");
    expect(rarityForZipf(7.7)).toBe("Very Common");
  });

  it("freezes the top rank's color at the cutover, not just its bands", () => {
    // Legend wore orange before the retune and wears black after it, so an
    // archived result shares the square it was played with.
    expect(raritySymbol("Legend", BEFORE)).toBe("🟧");
    expect(raritySymbol("Legend", ON)).toBe("⬛");
    expect(raritySymbol("Legend")).toBe("⬛");
    // Every other rank's square is the same on both sides of the line.
    for (const rarity of RARITY_ORDER.filter((r) => r !== "Legend")) {
      expect(raritySymbol(rarity, BEFORE)).toBe(raritySymbol(rarity, ON));
    }
  });

  it("marks the cutover by date, with no date meaning the newest system", () => {
    expect(usesRetunedTiers(BEFORE)).toBe(false);
    expect(usesRetunedTiers(ON)).toBe(true);
    expect(usesRetunedTiers("2027-03-01")).toBe(true);
    expect(usesRetunedTiers()).toBe(true);
  });

  it("splits Epic from Extremely Rare on the shown score, not between it", () => {
    // Epic is 9.1+ and purple tops out at 9.0, so no score can display on the
    // wrong side of the boundary.
    expect(rarityForZipf(1.58, ON)).toBe("Epic");
    expect(formatRarityScore(1.58, ON)).toBe("9.1");
    expect(rarityForZipf(1.59, ON)).toBe("Extremely Rare");
    expect(formatRarityScore(1.59, ON)).toBe("9.0");
    // Rare's floor is cut the same way: 6.8 is Rare, 6.7 is Uncommon.
    expect(rarityForZipf(3.14, ON)).toBe("Rare");
    expect(formatRarityScore(3.14, ON)).toBe("6.8");
    expect(rarityForZipf(3.15, ON)).toBe("Uncommon");
    expect(formatRarityScore(3.15, ON)).toBe("6.7");
  });

  it("never shows one score in two different tiers", () => {
    // Scores show to one decimal, so a band boundary landing mid-tenth would let
    // two words read the same number in different colors. Sweep every Zipf the
    // data can hold (hundredths) and check each displayed value maps to exactly
    // one tier.
    const tierFor = new Map<string, Rarity>();
    for (let hundredths = 0; hundredths <= 800; hundredths++) {
      const zipf = hundredths / 100;
      const shown = formatRarityScore(zipf, ON);
      const rarity = rarityForZipf(zipf, ON);
      const seen = tierFor.get(shown);
      if (seen === undefined) tierFor.set(shown, rarity);
      else expect(rarity, `score ${shown} appears as both ${seen} and ${rarity}`).toBe(seen);
    }
  });

  it("moves labels without moving a single score", () => {
    for (const zipf of [7.7, 6.2, 4.5, 3.0, 2.22, 1.6, 1.18, 0.4]) {
      expect(rarityScore(zipf, ON)).toBe(rarityScore(zipf, BEFORE));
    }
  });

  it("leaves the score-based top ranks alone", () => {
    // Mythic and Legend key off the score, not the Zipf bands, so retuning the
    // measured range must not touch them.
    for (const date of [BEFORE, ON]) {
      expect(rarityForZipf(1.18, date)).toBe("Mythic");
      expect(rarityForZipf(0.4, date)).toBe("Legend");
    }
  });
});

describe("display precision by score", () => {
  it("shows two decimals for Mythic and Legend scores", () => {
    expect(formatScore(10)).toBe("10.00"); // Legend
    expect(formatScore(9.9)).toBe("9.90"); // Legend floor
    expect(formatScore(9.85)).toBe("9.85"); // Mythic
    expect(formatScore(9.5)).toBe("9.50"); // Mythic floor
  });

  it("shows one decimal below the Mythic floor", () => {
    expect(formatScore(9.44)).toBe("9.4");
    expect(formatScore(4.3)).toBe("4.3");
    expect(formatScore(0)).toBe("0.0");
  });
});

describe("ranking colors", () => {
  // Share squares double as the per-ranking color key, so lock each one -- most
  // notably Epic's orange square, matching World of Warcraft's legendary hue,
  // and Legend's black one above it.
  it("maps every ranking to its color square", () => {
    expect(RARITY_SYMBOL).toEqual({
      Quotidian: "🥚",
      "Very Common": "⬜",
      Common: "🟫",
      Uncommon: "🟩",
      Rare: "🟦",
      "Extremely Rare": "🟪",
      Epic: "🟧",
      Mythic: "🟥",
      Legend: "⬛",
    });
  });

  it("gives every ranking a square", () => {
    for (const rarity of RARITY_ORDER) {
      expect(RARITY_SYMBOL[rarity], `${rarity} needs a share square`).toBeTruthy();
    }
  });

  // Read the stylesheet straight off disk: vitest stubs CSS imports (?raw and
  // raw globs both come back ""), so go through the filesystem instead.
  const css: string = readFileSync(`${process.cwd()}/src/index.css`, "utf8");

  it("defines a dot color for every ranking", () => {
    for (const rarity of RARITY_ORDER) {
      const slug = rarity.toLowerCase().replace(/ /g, "-");
      expect(css, `${rarity} needs a --rarity-${slug}-dot color`).toContain(`--rarity-${slug}-dot:`);
    }
  });

  it("uses World of Warcraft's legendary orange (#ff8000) for Epic", () => {
    expect(css).toContain("--rarity-epic-dot: #ff8000;");
  });

  it("gives Legend the black badge at the top of the ladder", () => {
    expect(css).toContain("--rarity-legend-bg: #1b1b1f;"); // light theme
    expect(css).toContain("--rarity-legend-bg: #000;"); // dark theme
  });

  it("uses a yellow accent for the best-word crown", () => {
    // Light theme yellow; dark theme keeps its own (brighter) yellow.
    expect(css).toContain("--best-word-accent: #eab308;");
    expect(css).toContain("--best-word-accent: #facc15;");
  });
});
