/**
 * A player's own numbers, for the Stats page (see components/StatsPage.tsx).
 *
 * Read from this browser's record -- every stored puzzle with a banked word and
 * the streak -- like the week and month totals (see game/totals.ts), so it works
 * for somebody who never joined a board. Archive puzzles count: a word found on
 * an old drop was still found, and this page is about what the player has done,
 * not about what may rank.
 *
 * Every score is priced at its own puzzle's date, the way the puzzle showed it.
 * Except the earliest: a puzzle before the legacy cutover is priced off data this
 * page never loads, and without it the legacy scale reads a word's Zipf times ten
 * -- a common word at 50. Those puzzles still count as played, but their words
 * and totals stay out of the best words and the per-mode scores.
 */

import { rarityScore, usesLegacyRarity } from "./dictionary";
import { type GameMode } from "./mode";
import { playedHistory } from "./storage";
import type { DailyProgress, Rarity, StreakState } from "./types";

/** The tiers a player can reach today, rarest first. Quotidian is retired. */
export const CURRENT_TIERS: readonly Rarity[] = [
  "Legend",
  "Mythic",
  "Elusive",
  "Extremely Rare",
  "Rare",
  "Uncommon",
  "Common",
];

/** How many of the best words the page lists; "Show more" opens the rest. */
export const TOP_WORDS = 5;

export interface StatWord {
  word: string;
  rarity: Rarity;
  zipf: number;
  date: string;
  mode?: GameMode;
  /** The displayed score, at `date`'s scoring. */
  score: number;
}

export interface PlayerStats {
  /** Distinct days with a banked word, either mode. */
  daysPlayed: number;
  wordsFound: number;
  /** Finished puzzles (every guess spent, or locked in). */
  finished: number;
  currentStreak: number;
  longestStreak: number;
  /** Words found per tier. Quotidian only appears when an old puzzle has one. */
  byRarity: Partial<Record<Rarity, number>>;
  /** Every scored word, highest score first and newest first on a tie, each word once. */
  topWords: StatWord[];
  /** The longest word banked, earliest first on a tie. */
  longestWord: StatWord | null;
}

function statWord(progress: DailyProgress, word: DailyProgress["acceptedWords"][number]): StatWord {
  return {
    word: word.word,
    rarity: word.rarity,
    zipf: word.zipf,
    date: progress.date,
    mode: progress.mode,
    score: rarityScore(word.zipf, progress.date),
  };
}

/** The numbers for `history` (by date, as storage.playedHistory returns it). */
export function computeStats(
  history: readonly DailyProgress[],
  streak: Pick<StreakState, "currentStreak" | "longestStreak">
): PlayerStats {
  const days = new Set<string>();
  const byRarity: Partial<Record<Rarity, number>> = {};
  const best = new Map<string, StatWord>();
  let longestWord: StatWord | null = null;
  let wordsFound = 0;
  let finished = 0;

  for (const progress of history) {
    if (progress.acceptedWords.length === 0) continue;
    days.add(progress.date);
    const scored = !usesLegacyRarity(progress.date);
    if (progress.completed) finished++;

    for (const accepted of progress.acceptedWords) {
      wordsFound++;
      byRarity[accepted.rarity] = (byRarity[accepted.rarity] ?? 0) + 1;
      const found = statWord(progress, accepted);
      const key = found.word.toLowerCase();
      const seen = best.get(key);
      if (scored && (!seen || found.score > seen.score)) best.set(key, found);
      if (!longestWord || found.word.length > longestWord.word.length) longestWord = found;
    }
  }

  const topWords = [...best.values()].sort(
    (a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.zipf - b.zipf
  );


  return {
    daysPlayed: days.size,
    wordsFound,
    finished,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    byRarity,
    topWords,
    longestWord,
  };
}

/** The numbers for this browser. */
export function loadStats(streak: StreakState): PlayerStats {
  return computeStats(playedHistory(), streak);
}
