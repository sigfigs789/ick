import { describe, expect, it } from "vitest";
import { buildShareText, puzzleNumber } from "./share";
import dropData from "../data/drops.json";
import { rarityScore } from "./dictionary";
import type { AcceptedWord } from "./types";

describe("puzzleNumber", () => {
  it("is 1 on the epoch date", () => {
    expect(puzzleNumber(dropData.epoch)).toBe(1);
  });

  it("increments by 1 per day", () => {
    expect(puzzleNumber("2024-01-02")).toBe(puzzleNumber("2024-01-01") + 1);
  });
});

describe("buildShareText", () => {
  const words: AcceptedWord[] = [
    { word: "the", rarity: "Very Common", zipf: 7.7 },
    { word: "strange", rarity: "Common", zipf: 4.6 },
    { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
  ];

  it("includes the date and drop, never the words themselves", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).toContain("Jan 5 — Drop: STR");
    expect(text).toMatch(/wordink\.app$/);
    expect(text).not.toContain("utm_source");
    expect(text).toContain("Drop: STR");
    for (const w of words) {
      expect(text).not.toContain(w.word);
    }
  });

  it("puts each spoiler-free rarity square and score on its own line", () => {
    const text = buildShareText("2024-01-05", "str", words);
    const resultLines = text.split("\n").slice(2, 2 + words.length);
    expect(resultLines).toEqual(
      ["⬜", "🟫", "🟪"].map(
        (symbol, i) =>
          `${symbol} ${rarityScore(words[i].zipf, "2024-01-05").toFixed(1)}`,
      ),
    );
  });

  it("separates the heading from the shared guesses", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).toContain("Drop: STR\n\n⬜ 0.0");
  });

  it("omits the best-word summary", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).not.toContain("Best:");
  });

  it("is spoiler-free by default, with no explicit option passed", () => {
    const withDefault = buildShareText("2024-01-05", "str", words);
    const withExplicitTrue = buildShareText("2024-01-05", "str", words, {
      spoilerFree: true,
    });
    expect(withDefault).toBe(withExplicitTrue);
  });

  it("can omit the source parameter from the shared URL", () => {
    expect(
      buildShareText("2024-01-05", "str", words, { source: null }),
    ).toContain("\nwordink.app");
  });

  it("adds compact share attribution only when explicitly requested", () => {
    expect(
      buildShareText("2024-01-05", "str", words, { source: "share" }),
    ).toMatch(/https:\/\/wordink\.app\/\?s=sh$/);
  });

  it("uses a compact X attribution code without a protocol prefix", () => {
    expect(
      buildShareText("2024-01-05", "str", words, { source: "twitter" }),
    ).toMatch(/wordink\.app\/\?s=t$/);
  });

  it("shows the actual words and rarity scores, without rarity labels, when spoilerFree is false", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      spoilerFree: false,
    });
    for (const w of words) {
      expect(text).toContain(w.word);
    }
    expect(text).toContain(
      `aardvark (${rarityScore(2.4, "2024-01-05").toFixed(1)})`,
    );
    expect(text).not.toContain("Extremely Rare");
  });

  it("uses a compact X layout without progress stats while preserving parenthesized answer scores", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      spoilerFree: false,
      streak: 4,
      crushedIt: 7,
      elite: 2,
      source: null,
      format: "x",
    });

    expect(text).toContain(
      `🟪 aardvark (${rarityScore(2.4, "2024-01-05").toFixed(1)})`,
    );
    expect(text).not.toContain("Streak:");
    expect(text).not.toContain("Crushed it:");
    expect(text).not.toContain("Elite:");
    expect(text).not.toContain("Top:");
    expect(text).toContain("Total:");
  });

  it("puts each word and its rarity square on a separate line", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      spoilerFree: false,
    });
    const resultLines = text.split("\n").slice(2, 2 + words.length);
    // aardvark: Extremely Rare -> 🟪
    expect(resultLines).toContain(
      `🟪 aardvark (${rarityScore(2.4, "2024-01-05").toFixed(1)})`,
    );
    expect(resultLines).toContain("⬜ the (0.0)");
    expect(resultLines).toHaveLength(words.length);
  });

  it("omits the best-word summary when spoilers are shown", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      spoilerFree: false,
    });
    expect(text).not.toContain("Best:");
  });

  it("names the rarest word and its 1-in-X frequency, just before the URL, when spoilers are shown", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      spoilerFree: false,
      source: null,
    });
    // aardvark (zipf 2.4) is the rarest: 10^(9 - 2.4) ≈ 3.98M -> "4M".
    expect(text).toContain("\naardvark: 1 in 4M words\nwordink.app");
  });

  it("shows the rarest word's odds under a generic label, never its name, in the spoiler-free share", () => {
    const text = buildShareText("2024-01-05", "str", words);
    expect(text).not.toContain("aardvark");
    // aardvark (zipf 2.4) is the rarest: 10^(9 - 2.4) ≈ 3.98M -> "4M".
    expect(text).toContain("\nRarest word: 1 in 4M words\nwordink.app");
  });

  it('names only the rarest word, leaving the rest anonymous, when reveal is "top"', () => {
    const text = buildShareText("2024-01-05", "str", words, { reveal: "top" });
    // aardvark (zipf 2.4) is the rarest, so it is the only word named.
    expect(text).toContain(
      `🟪 aardvark (${rarityScore(2.4, "2024-01-05").toFixed(1)})`,
    );
    expect(text).not.toContain("strange");
    expect(text).not.toContain("the (");
    // The odds line names the rarest word too, rather than the generic label.
    expect(text).toContain("\naardvark: 1 in 4M words\nwordink.app");
  });

  it('reveal "all" matches the deprecated spoilerFree:false, and "none" matches the default', () => {
    expect(buildShareText("2024-01-05", "str", words, { reveal: "all" })).toBe(
      buildShareText("2024-01-05", "str", words, { spoilerFree: false }),
    );
    expect(buildShareText("2024-01-05", "str", words, { reveal: "none" })).toBe(
      buildShareText("2024-01-05", "str", words),
    );
  });

  it("includes the current streak when provided", () => {
    expect(buildShareText("2024-01-05", "str", words, { streak: 1 })).toContain(
      "Streak: 1 day",
    );
    expect(buildShareText("2024-01-05", "str", words, { streak: 4 })).toContain(
      "Streak: 4 days",
    );
  });

  it("puts the session total directly before the current puzzle's top rarity", () => {
    const text = buildShareText("2024-01-05", "str", words, {
      streak: 4,
      crushedIt: 7,
      elite: 2,
    });

    const total = words.reduce(
      (sum, word) => sum + rarityScore(word.zipf, "2024-01-05"),
      0,
    );
    expect(text).toContain(
      `🟪 ${rarityScore(2.4, "2024-01-05").toFixed(1)}\n\nStreak: 4 days · Crushed it: 7 · Elite: 2\nTotal: ${total.toFixed(1)} · Top: ${rarityScore(2.4, "2024-01-05").toFixed(1)}`,
    );
  });
});
