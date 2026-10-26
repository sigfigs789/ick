/**
 * The news card for the day before's best word (see
 * components/BestWordNewsCard.tsx), shown over today's puzzle as the site opens.
 *
 * Two readers get it:
 *
 * - **The finder.** A player who found the best word is told so, whatever else
 *   is going on -- it is their win, and the card waits its turn behind any
 *   other celebration rather than giving way to it.
 * - **Everybody else**, once in their lifetime: the card is there to tell them
 *   the mechanic exists, so a player who has seen a best word card of either
 *   kind is never told about somebody else's again. Only from their
 *   BEST_WORD_NEWS_MIN_DAYS-th day played, and only when nothing else is on
 *   screen: it is somebody else's news, and it is not worth crowding out the
 *   player's own. A newer player has the footnote under the puzzle
 *   (components/YesterdaysBest.tsx) and enough to take in without it.
 *
 * Either way, once a day: the card is remembered by the day it reports, so a
 * reload, another tab or a trip back from the boards does not bring it back.
 * That same record is how a player is known to have seen one at all.
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
 * neither found it nor has played enough days to be told, or who has already
 * seen a best word card (`everShown`) and so knows the mechanic.
 */
export function bestWordNewsFor(
  finderIds: readonly string[] | null,
  selfId: string | null,
  daysPlayed: number,
  everShown: boolean,
): BestWordNewsKind | null {
  if (!finderIds || finderIds.length === 0) return null;
  const self = selfId?.toLowerCase();
  if (self && finderIds.some((id) => id.toLowerCase() === self)) return "self";
  return daysPlayed >= BEST_WORD_NEWS_MIN_DAYS && !everShown ? "other" : null;
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

/** Whether any day's best word has ever had its card on this browser. */
export function bestWordNewsEverShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) !== null;
  } catch {
    // Unreadable storage: assume they have, so somebody else's news stays away.
    return true;
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
