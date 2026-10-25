/**
 * The news card for the day before's best word (see
 * components/BestWordNewsCard.tsx), shown over today's puzzle as the site opens.
 *
 * Two readers get it:
 *
 * - **The finder.** A player who found the best word is told so, whatever else
 *   is going on -- it is their win, and the card waits its turn behind any
 *   other celebration rather than giving way to it.
 * - **Everybody else**, once they have played BEST_WORD_NEWS_MIN_DAYS days, and
 *   only when nothing else is on screen: the card is somebody else's news, and
 *   it is not worth crowding out the player's own. A newer player has the
 *   footnote under the puzzle (components/YesterdaysBest.tsx) and enough to
 *   take in without it.
 *
 * Either way, once a day: the card is remembered by the day it reports, so a
 * reload, another tab or a trip back from the boards does not bring it back.
 */

import { playedHistory } from "./storage";

/** Days played before a player is told about somebody else's best word. */
export const BEST_WORD_NEWS_MIN_DAYS = 4;

const SHOWN_KEY = "ick:bestWordNewsShown";

export type BestWordNewsKind = "self" | "other";

/**
 * Which card, if any, this reader is owed for a best word with these finders.
 * Null when the finders couldn't be read -- a reader who might have been one of
 * them should not be told somebody else found it -- and for a reader who
 * neither found it nor has played enough days to be told.
 */
export function bestWordNewsFor(
  finderIds: readonly string[] | null,
  selfId: string | null,
  daysPlayed: number,
): BestWordNewsKind | null {
  if (!finderIds || finderIds.length === 0) return null;
  const self = selfId?.toLowerCase();
  if (self && finderIds.some((id) => id.toLowerCase() === self)) return "self";
  return daysPlayed >= BEST_WORD_NEWS_MIN_DAYS ? "other" : null;
}

/** Days with at least one accepted word, counting a day played both ways once. */
export function daysPlayed(): number {
  return new Set(playedHistory().map((progress) => progress.date)).size;
}

/** Whether `day`'s best word has already had its card. */
export function bestWordNewsShown(day: string): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === day;
  } catch {
    return false;
  }
}

/** Remember that `day`'s best word has had its card. */
export function markBestWordNewsShown(day: string): void {
  try {
    localStorage.setItem(SHOWN_KEY, day);
  } catch {
    // Storage that cannot be written means a second card on a reload, at worst.
  }
}
