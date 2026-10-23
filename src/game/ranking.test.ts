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
  ["the", "Common", 1],
  ["castle", "Common", 1],
  ["chateau", "Uncommon", 1],
  ["awol", "Rare", 1],
  ["okapi", "Extremely Rare", 1],
  ["borborygmus", "Elusive", 1],
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
    [7.7, "Common"],
    [5.6, "Common"],
    [4.5, "Common"],
    [3.5, "Uncommon"],
    [2.5, "Rare"],
    [1.8, "Extremely Rare"],
    [1.45, "Elusive"],
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

  it("scores a Zipf of 2.0 at 8.57 and ranks it Extremely Rare", () => {
    expect(rarityScore(2.0)).toBe(8.57);
    expect(formatRarityScore(2.0)).toBe("8.6");
    expect(rarityForZipf(2.0)).toBe("Extremely Rare");
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
    [7.7, "Common"],
    [3.9, "Common"],
    [3.89, "Uncommon"],
    [3.15, "Uncommon"],
    [3.14, "Rare"],
    [2.13, "Rare"],
    [2.12, "Extremely Rare"],
    [1.59, "Extremely Rare"],
    [1.58, "Elusive"],
  ];

  // Dated only: from DECADE_BANDS_START the measured labels come off the shown
  // score instead of these cutoffs, so an undated call answers the newer
  // question. The suite below owns that one.
  it.each(EDGES)("Zipf %s sits in %s", (zipf, rarity) => {
    expect(rarityForZipf(zipf, ON)).toBe(rarity);
  });

  it("keeps archived puzzles on the bands they were played with", () => {
    // Zipf 2.22 ("gorgonzola") was Extremely Rare under the original bands and
    // is Rare under the retuned ones -- the clearest single word for the shift.
    expect(rarityForZipf(2.22, BEFORE)).toBe("Extremely Rare");
    expect(rarityForZipf(2.22, ON)).toBe("Rare");
    // Elusive exists only under the retuned bands.
    expect(rarityForZipf(1.4, BEFORE)).toBe("Extremely Rare");
    expect(rarityForZipf(1.4, ON)).toBe("Elusive");
  });

  it("retires Quotidian without disturbing the puzzles that had it", () => {
    // The bottom tier was folded in, but only forwards: an archived puzzle's
    // everyday word still reads Quotidian.
    expect(rarityForZipf(7.7, BEFORE)).toBe("Quotidian");
    expect(rarityForZipf(7.7, ON)).toBe("Common");
    expect(rarityForZipf(7.7)).toBe("Common");
  });

  it("keeps the retuned bands live for the puzzles between the two cutovers", () => {
    // 2026-08-21 through 2026-08-26 are the only dates these cutoffs answer for.
    expect(rarityForZipf(1.58, "2026-08-26")).toBe("Elusive");
    expect(rarityForZipf(1.59, "2026-08-26")).toBe("Extremely Rare");
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

  it("splits Elusive from Extremely Rare on the shown score, not between it", () => {
    // Elusive is 9.1+ and purple tops out at 9.0, so no score can display on the
    // wrong side of the boundary.
    expect(rarityForZipf(1.58, ON)).toBe("Elusive");
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

describe("whole-point measured bands (from 2026-08-27)", () => {
  const BEFORE = "2026-08-26"; // last day on the Zipf-cutoff bands
  const ON = "2026-08-27"; // first day on the whole-point bands

  // Each band, top and bottom, by the Zipf that lands there. The point of the
  // change is that these are readable off the score, so every case pins the
  // shown number beside the label.
  const EDGES: ReadonlyArray<[zipf: number, shown: string, rarity: Rarity]> = [
    [1.35, "9.4", "Elusive"],
    [1.71, "9.0", "Elusive"],
    [1.72, "8.9", "Extremely Rare"],
    [2.45, "8.0", "Extremely Rare"],
    [2.46, "7.9", "Rare"],
    [3.19, "7.0", "Rare"],
    [3.2, "6.9", "Uncommon"],
    [3.91, "6.0", "Uncommon"],
    [3.92, "5.9", "Common"],
    [4.61, "5.0", "Common"],
    [4.62, "4.9", "Common"],
  ];

  it.each(EDGES)("Zipf %s shows %s and sits in %s", (zipf, shown, rarity) => {
    expect(formatRarityScore(zipf, ON)).toBe(shown);
    expect(rarityForZipf(zipf, ON)).toBe(rarity);
    expect(rarityForZipf(zipf)).toBe(rarity); // undefined date = newest system
  });

  it("makes the score's whole point the rank, for every value it can show", () => {
    // The whole reason the bands moved: a player reading 8.7 can see they are
    // three tenths off the next rank. That only holds if the leading digit and
    // the label never disagree -- sweep every Zipf the data can hold and check.
    const BAND: Record<string, Rarity> = {
      "9": "Elusive",
      "8": "Extremely Rare",
      "7": "Rare",
      "6": "Uncommon",
    };
    for (let hundredths = 100; hundredths <= 800; hundredths++) {
      const zipf = hundredths / 100;
      const rarity = rarityForZipf(zipf, ON);
      if (rarity === "Mythic" || rarity === "Legend") continue;
      const shown = formatRarityScore(zipf, ON);
      const expected = BAND[shown.split(".")[0]] ?? "Common";
      expect(rarity, `${shown} should be ${expected}, not ${rarity}`).toBe(expected);
    }
  });

  it("lifts every measured score and lowers none", () => {
    // The curve pins both ends of the measured band and bends the middle up, so
    // no archived score can be beaten by the same word played today.
    // Up to the data's maximum: past it the straight line ran negative and the
    // curve floors at 0, which is the one place the two can disagree downward.
    for (let hundredths = 100; hundredths <= 773; hundredths++) {
      const zipf = hundredths / 100;
      expect(rarityScore(zipf, ON)).toBeGreaterThanOrEqual(rarityScore(zipf, BEFORE));
    }
    // Both ends stay exactly where they were; only the middle moves.
    expect(rarityScore(1, ON)).toBe(rarityScore(1, BEFORE));
    expect(rarityScore(7.73, ON)).toBe(rarityScore(7.73, BEFORE));
    expect(rarityScore(3.5, ON)).toBeGreaterThan(rarityScore(3.5, BEFORE));
  });

  it("demotes nothing", () => {
    // Labels move up with the scores. There used to be one exception -- a
    // window at Zipf 4.62..4.84 where Common fell to Very Common -- and retiring
    // Very Common closed it.
    for (let hundredths = 100; hundredths <= 773; hundredths++) {
      const zipf = hundredths / 100;
      const before = rarityForZipf(zipf, BEFORE);
      const after = rarityForZipf(zipf, ON);
      // RARITY_ORDER runs rarest-first, so a rank going up means a lower index.
      expect(
        RARITY_ORDER.indexOf(after),
        `Zipf ${zipf} dropped from ${before} to ${after}`
      ).toBeLessThanOrEqual(RARITY_ORDER.indexOf(before));
    }
  });

  it("leaves the deep tail and the top ranks exactly as they were", () => {
    // The curve touches only the measured band, and Legend/Mythic key off the
    // score cutoffs either side of the cutover.
    for (const zipf of [-1.57, 0.4, 0.9, 1.0]) {
      expect(rarityScore(zipf, ON)).toBe(rarityScore(zipf, BEFORE));
      expect(rarityForZipf(zipf, ON)).toBe(rarityForZipf(zipf, BEFORE));
    }
    // Mythic sits just inside the measured band, so its score does move -- but
    // the rank it keys off does not.
    expect(rarityForZipf(1.11, ON)).toBe("Mythic");
    expect(rarityForZipf(1.11, BEFORE)).toBe("Mythic");
  });

  it("keeps archived puzzles on the bands they were played with", () => {
    // Zipf 2.22 ("gorgonzola") was Rare the day before the cutover and is
    // Extremely Rare on it -- purple's floor moving down the scale.
    expect(rarityForZipf(2.22, BEFORE)).toBe("Rare");
    expect(rarityForZipf(2.22, ON)).toBe("Extremely Rare");
    expect(rarityScore(2.22, BEFORE)).toBe(8.11);
    expect(rarityScore(2.22, ON)).toBe(8.27);
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
  // notably Elusive's gold square, the one no other rank uses, and Legend's
  // black one above it.
  it("maps every ranking to its color square", () => {
    expect(RARITY_SYMBOL).toEqual({
      Quotidian: "🥚",
      Common: "⬜",
      Uncommon: "🟩",
      Rare: "🟦",
      "Extremely Rare": "🟪",
      Elusive: "🟨",
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

  it("gives Elusive gold, distinct from Common's brown and Mythic's red", () => {
    expect(css).toContain("--rarity-elusive-dot: #eab308;");
  });

  it("keeps the pre-retune Legend orange on its own frozen tokens", () => {
    // Archived puzzles render Legend from these, so retinting Elusive must not be
    // able to reach back and restyle a drop that was played before the cutover.
    expect(css).toContain("--rarity-legend-legacy-dot: #ff8000;");
    expect(css).not.toContain("--rarity-legend-legacy-dot: var(");
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
