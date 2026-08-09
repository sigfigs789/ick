import { daysSinceEpoch, toDateString } from "./date";
import fragmentData from "../data/fragments.json";
import type { AcceptedWord, Rarity } from "./types";

// Distinct color AND distinct square per rarity band would be nice, but
// emoji squares only vary by color -- that's fine here because this text is
// for sharing outside the app. Inside the app, rarity is always shown as a
// plain-text label too (see RarityBadge), which is what keeps things
// color-independent for accessibility.
const RARITY_SYMBOL: Record<Rarity, string> = {
  "Very Common": "🟩",
  Common: "🟦",
  Uncommon: "🟨",
  Rare: "🟧",
  "Extremely Rare": "🟥",
};

export function puzzleNumber(dateStr: string): number {
  return daysSinceEpoch(dateStr, fragmentData.epoch) + 1;
}

/** Spoiler-free: shows rarity symbols and the fragment, never the words themselves. */
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
  return [`Ick #${n} (${label}) — fragment "${fragment}"`, squares, `${words.length}/3 words found`].join(
    "\n"
  );
}

export function todayShareText(fragment: string, words: AcceptedWord[]): string {
  return buildShareText(toDateString(new Date()), fragment, words);
}
