import { daysSinceEpoch, toDateString } from "./date";
import { MAX_GUESSES } from "./constants";
import { bestWord } from "./rank";
import fragmentData from "../data/fragments.json";
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
  return daysSinceEpoch(dateStr, fragmentData.epoch) + 1;
}

/**
 * Spoiler-free: shows rarity symbols and the fragment, never the words
 * themselves. Squares are in guess order (like a Wordle grid); the "best"
 * line calls out the single rarest word, since that's the goal now.
 */
export function buildShareText(
  dateStr: string,
  fragment: string,
  words: AcceptedWord[]
): string {
  const n = puzzleNumber(dateStr);
  const squares = words.map((w) => RARITY_SYMBOL[w.rarity]).join(" ");
  const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const best = bestWord(words);
  const lines = [`Ick #${n} (${label}) — fragment "${fragment}"`, squares];
  if (best) lines.push(`Best: ${best.rarity} · ${words.length}/${MAX_GUESSES} guesses`);
  return lines.join("\n");
}

export function todayShareText(fragment: string, words: AcceptedWord[]): string {
  return buildShareText(toDateString(new Date()), fragment, words);
}
