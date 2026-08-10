import { daysSinceEpoch, formatDateLabel, toDateString } from "./date";
import { MAX_GUESSES } from "./constants";
import { rarityScore } from "./dictionary";
import { bestWord } from "./rank";
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
};

export function puzzleNumber(dateStr: string): number {
  return daysSinceEpoch(dateStr, dropData.epoch) + 1;
}

export interface ShareOptions {
  /** Defaults to true: omit the words-with-rarity line, squares only. */
  spoilerFree?: boolean;
}

/**
 * Spoiler-free (the default): a single line of rarity squares, guess
 * order, like a Wordle grid -- no words. Pass `spoilerFree: false` to
 * swap that for a line listing each word with its own rarity square
 * directly in front of it, so the color is legible right next to the
 * word it describes rather than in a separate row. The "best" line calls
 * out the single rarest word either way, since that's the goal now.
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
  const best = bestWord(words);

  const resultLine = spoilerFree
    ? words.map((w) => RARITY_SYMBOL[w.rarity]).join(" ")
    : words
        .map(
          (w) => `${RARITY_SYMBOL[w.rarity]} ${w.word} (${w.rarity}, ${rarityScore(w.zipf).toFixed(1)})`
        )
        .join(" · ");

  const lines = [`Ink #${n} (${label}) — drop "${drop}"`, resultLine];
  if (best) {
    const score = rarityScore(best.zipf).toFixed(1);
    lines.push(`Best: ${best.rarity} (${score}) · ${words.length}/${MAX_GUESSES} guesses`);
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
