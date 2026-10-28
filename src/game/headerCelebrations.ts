/**
 * The header celebrations: the cards that float over the top of today's
 * puzzle to celebrate something or bring the player news (see the README's
 * "Header celebrations"). They come in two groups, and each group shows at
 * most one card a day:
 *
 * - **streak**: the longest streak yet (NewBestCelebration), then a climb up
 *   the streak board (StreakClimbCelebration).
 * - **news**: yesterday's best word (BestWordNewsCard), then a perfect month
 *   (PerfectMonthCelebration), then an improving average
 *   (ImprovementCelebration), then a top-three place on today's board
 *   (TopRankCelebration).
 *
 * The top-three card is last of all: it shows only on a day neither group has
 * claimed, and claims the news group's day itself.
 *
 * Each group's cards come due in that order through the day -- the best word
 * as the site opens, a perfect month and a new best on the first word, the
 * climb a moment after that word, the average on the finish, the top three a
 * moment after the finish -- so the first
 * card to claim its group's day is the one with priority. The claim is kept in storage, so a
 * reload between the first word and the finish does not let a second card in.
 *
 * A new player sees none of them until they have banked their fourth word:
 * the first three are for finding their feet, not for cards over the puzzle.
 */

import { playedHistory } from "./storage";

export type HeaderCelebrationGroup = "streak" | "news";

const KEY_PREFIX = "ick:headerCelebration:";

/** The words a player banks, across every day and mode, before any card shows. */
export const HEADER_CELEBRATIONS_MIN_WORDS = 4;

/**
 * Whether the header celebrations are still held back from a new player: true
 * until they have banked HEADER_CELEBRATIONS_MIN_WORDS words in all.
 */
export function headerCelebrationsHeld(): boolean {
  let banked = 0;
  for (const progress of playedHistory()) {
    banked += progress.acceptedWords.length;
    if (banked >= HEADER_CELEBRATIONS_MIN_WORDS) return false;
  }
  return true;
}

/** Whether `group` has already had its card on `date`. */
export function headerCelebrationShown(group: HeaderCelebrationGroup, date: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + group) === date;
  } catch {
    return false;
  }
}

/**
 * Claim `group`'s one card for `date`: true if the card may show, false when
 * another of the group's cards already has today. The 25% of players the
 * header celebrations test hides them from (see headerCelebrationsTest.ts) are
 * kept out by the caller, not here.
 */
export function claimHeaderCelebration(group: HeaderCelebrationGroup, date: string): boolean {
  if (headerCelebrationShown(group, date)) return false;
  try {
    localStorage.setItem(KEY_PREFIX + group, date);
  } catch {
    // Storage that cannot be written means a second card after a reload, at worst.
  }
  return true;
}
