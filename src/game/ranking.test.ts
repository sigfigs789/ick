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
} from "./dictionary";
import { RARITY_SYMBOL } from "./share";
import type { Rarity } from "./types";

// Minimal ambient for the Node global (this app doesn't depend on @types/node).
declare const process: { cwd(): string };

// Every ranking, a representative dictionary word, its expected label, and how
// many decimals its score should show (two for the top two ranks, one for the
// rest). Words are pinned so a scoring/label regression is actually caught.
const RANKINGS: ReadonlyArray<[word: string, rarity: Rarity, decimals: number]> = [
  ["the", "Quotidian", 1],
  ["there", "Very Common", 1],
  ["cat", "Common", 1],
  ["chateau", "Uncommon", 1],
  ["awol", "Rare", 1],
  ["gorgonzola", "Extremely Rare", 1],
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
    [7.7, "Quotidian"],
    [5.6, "Very Common"],
    [4.5, "Common"],
    [3.5, "Uncommon"],
    [2.8, "Rare"],
    [1.9, "Extremely Rare"],
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
  // notably Legend's orange square, matching its World of Warcraft legendary hue.
  it("maps every ranking to its color square", () => {
    expect(RARITY_SYMBOL).toEqual({
      Quotidian: "🥚",
      "Very Common": "⬜",
      Common: "🟫",
      Uncommon: "🟩",
      Rare: "🟦",
      "Extremely Rare": "🟪",
      Mythic: "🟥",
      Legend: "🟧",
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

  it("uses World of Warcraft's legendary orange (#ff8000) for Legend", () => {
    expect(css).toContain("--rarity-legend-dot: #ff8000;");
  });

  it("uses a yellow accent for the best-word crown", () => {
    // Light theme yellow; dark theme keeps its own (brighter) yellow.
    expect(css).toContain("--best-word-accent: #eab308;");
    expect(css).toContain("--best-word-accent: #facc15;");
  });
});
