import { daysSinceEpoch, formatDateLabel, toDateString } from "./date";
import { rarityScore, topRarityScore, totalRarityScore } from "./dictionary";
import dropData from "../data/drops.json";
import type { AcceptedWord, Rarity } from "./types";

// Mirrors the in-app "loot tier" rarity palette (black -> grey -> yellow ->
// green -> blue -> purple -> red, see index.css) so the shared result matches
// what showed up in-game. Quotidian's egg is an intentional Easter egg.
// Squares only vary by color, which is fine here because this text is for
// sharing outside the app -- inside the app, rarity is always shown as a
// plain-text label too (see RarityBadge), which is what keeps things
// color-independent for accessibility.
const RARITY_SYMBOL: Record<Rarity, string> = {
  Quotidian: "🥚",
  "Very Common": "⬜",
  Common: "🟨",
  Uncommon: "🟩",
  Rare: "🟦",
  "Extremely Rare": "🟪",
  Mythic: "🟥",
};

export type ShareSource = "share";

function shareUrl(source: ShareSource | null): string {
  return source ? `wordink.app/?utm_source=${source}` : "wordink.app";
}

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
  /** Identifies the channel through which this result was shared. */
  source?: ShareSource | null;
}

/**
 * Spoiler-free (the default): one line per rarity square and score, with
 * no words. Pass `spoilerFree: false` to
 * swap that for one line per word, each with its own rarity square and
 * numeric rarity score.
 */
export function buildShareText(
  dateStr: string,
  drop: string,
  words: AcceptedWord[],
  options: ShareOptions = {}
): string {
  const spoilerFree = options.spoilerFree ?? true;
  const source = options.source === undefined ? "share" : options.source;
  const n = puzzleNumber(dateStr);
  const label = formatDateLabel(dateStr);

  const resultLine = spoilerFree
    ? words
        .map((w) => `${RARITY_SYMBOL[w.rarity]} ${rarityScore(w.zipf).toFixed(1)}`)
        .join("\n")
    : words
        .map(
          (w) => `${RARITY_SYMBOL[w.rarity]} ${w.word} (${rarityScore(w.zipf).toFixed(1)})`
        )
        .join("\n");

  const lines = [`${shareUrl(source)} #${n} (${label}) — Drop: ${drop.toUpperCase()}`];
  if (resultLine) lines.push("", resultLine);
  if (options.streak !== undefined || options.crushedIt !== undefined || options.elite !== undefined) {
    const streak = options.streak ?? 0;
    if (resultLine) lines.push("");
    lines.push(
      `Streak: ${streak} day${streak === 1 ? "" : "s"} · Crushed it: ${options.crushedIt ?? 0} · Elite: ${options.elite ?? 0}`
    );
  }
  const raritySummary = [`Total: ${totalRarityScore(words).toFixed(1)}`];
  raritySummary.push(`Top: ${topRarityScore(words).toFixed(1)}`);
  lines.push(raritySummary.join(" · "));
  return lines.join("\n");
}

export function todayShareText(
  drop: string,
  words: AcceptedWord[],
  options?: ShareOptions
): string {
  return buildShareText(toDateString(new Date()), drop, words, options);
}
