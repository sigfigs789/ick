import { daysSinceEpoch, formatDateLabel, toDateString } from "./date";
import { rarityScore } from "./dictionary";
import dropData from "../data/drops.json";
import type { AcceptedWord, Rarity } from "./types";

// Mirrors the in-app "loot tier" rarity palette (grey -> green -> blue ->
// purple -> gold, see index.css) so the shared result matches what showed
// up in-game. Squares only vary by color, which is fine here because this
// text is for sharing outside the app -- inside the app, rarity is always
// shown as a plain-text label too (see RarityBadge), which is what keeps
// things color-independent for accessibility.
const RARITY_SYMBOL: Record<Rarity, string> = {
  "Very Common": "⬜",
  Common: "🟩",
  Uncommon: "🟦",
  Rare: "🟪",
  "Extremely Rare": "🟧",
  Elusive: "🟥",
};

export function puzzleNumber(dateStr: string): number {
  return daysSinceEpoch(dateStr, dropData.epoch) + 1;
}

export interface ShareOptions {
  /** Defaults to true: omit the words-with-rarity line, squares only. */
  spoilerFree?: boolean;
  /** Current consecutive-day streak to include in the shared result. */
  streak?: number;
  /** Total Rare-or-better results to include in the shared result. */
  crushedIt?: number;
  /** Total Extremely Rare-or-better results to include in the shared result. */
  elite?: number;
  /** Highest rarity score to include in the shared result. */
  highScore?: number;
}

/**
 * Spoiler-free (the default): one line per rarity square and score, with
 * no words. Pass `spoilerFree: false` to
 * swap that for one line per word, each with its own rarity square
 * directly in front of it, so the color is legible right next to the
 * word it describes rather than in a separate row.
 */
export function buildShareText(
  dateStr: string,
  drop: string,
  words: AcceptedWord[],
  options: ShareOptions = {}
): string {
  const spoilerFree = options.spoilerFree ?? true;
  const n = puzzleNumber(dateStr);
  const label = formatDateLabel(dateStr);

  const resultLine = spoilerFree
    ? words
        .map((w) => `${RARITY_SYMBOL[w.rarity]} ${rarityScore(w.zipf).toFixed(1)}`)
        .join("\n")
    : words
        .map(
          (w) => `${RARITY_SYMBOL[w.rarity]} ${w.word} (${w.rarity}, ${rarityScore(w.zipf).toFixed(1)})`
        )
        .join("\n");

  const lines = [`https://wordink.app #${n} (${label}) — Ink: ${drop.toUpperCase()}`];
  if (resultLine) lines.push("", resultLine);
  if (options.streak !== undefined || options.crushedIt !== undefined || options.elite !== undefined) {
    const streak = options.streak ?? 0;
    if (resultLine) lines.push("");
    lines.push(
      `Streak: ${streak} day${streak === 1 ? "" : "s"} · Crushed it: ${options.crushedIt ?? 0} · Elite: ${options.elite ?? 0}`
    );
  }
  if (options.highScore !== undefined) {
    lines.push(`High score: ${options.highScore.toFixed(1)}`);
  }
  return lines.join("\n");
}

export function todayShareText(
  drop: string,
  words: AcceptedWord[],
  options?: ShareOptions
): string {
  return buildShareText(toDateString(new Date()), drop, words, options);
}
