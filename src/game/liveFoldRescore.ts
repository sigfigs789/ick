// What a live fold rejection does to a game the player already played: the
// word they banked is priced again on its own frequency, and they are told so.
//
// The scoring itself needs nothing from here -- once a puzzle's rejections are
// in the registry, `adjustedZipf` stops folding those words (see
// game/liveFoldRejections.ts). What it cannot reach is a score already stored:
// a game saves each word's price as it was banked, and the guess log, the total
// and the leaderboard all read that. So this reprices the stored words, and
// remembers which notices the player has closed.

import { corpusEntry } from "./corpus";
import { rarityFor, rarityForUncurated, unattestedZipf, usesFreeformRules } from "./dictionary";
import { liveFoldRejectionsFor } from "./liveFoldRejections";
import type { AcceptedWord, DailyProgress } from "./types";

/** One of the player's words whose fold was rejected, as the bubble names it. */
export interface LiveFoldNotice {
  word: string;
  /** The common form it had been scored as. */
  base: string;
  /** What it scores now, on its own frequency. */
  zipf: number;
}

/**
 * The player's words on this puzzle whose fold was rejected, priced afresh.
 *
 * Every rejected word they hold gets a notice, whether or not its stored price
 * still needs to move: the price moves once, and the player who reopens the
 * puzzle a day later is still owed the reason their word reads differently.
 *
 * A Freeform game never folded, so it has nothing to correct. A word neither
 * the curated list nor the corpus knows came from the live Merriam-Webster
 * lookup, which never folds either, and is left as it is.
 */
export function liveFoldRescore(progress: DailyProgress): {
  rescored: Map<string, AcceptedWord>;
  notices: LiveFoldNotice[];
} {
  const rescored = new Map<string, AcceptedWord>();
  const notices: LiveFoldNotice[] = [];
  if (usesFreeformRules(progress.date, progress.mode)) return { rescored, notices };

  const rejected = new Map(
    liveFoldRejectionsFor(progress.date).map((rejection) => [rejection.word, rejection.base])
  );
  if (rejected.size === 0) return { rescored, notices };

  for (const accepted of progress.acceptedWords) {
    const base = rejected.get(accepted.word);
    if (base === undefined) continue;
    const price = ownPrice(accepted.word, progress);
    if (!price) continue;
    rescored.set(accepted.word, { ...accepted, ...price });
    notices.push({ word: accepted.word, base, zipf: price.zipf });
  }
  return { rescored, notices };
}

/** The word's price on this puzzle now that its fold is off. */
function ownPrice(word: string, progress: DailyProgress): Pick<AcceptedWord, "zipf" | "rarity"> | undefined {
  const curated = rarityFor(word, progress.date, progress.mode);
  if (curated) return curated;
  const entry = corpusEntry(word);
  if (!entry) return undefined;
  return rarityForUncurated(word, entry.zipf ?? unattestedZipf(), progress.date);
}

/** Notices the player has closed, as `date:word`. */
const SEEN_KEY = "ick:folded-live-seen";

function loadSeen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** The notices on `date` the player has not closed yet. */
export function unseenNotices(date: string, notices: readonly LiveFoldNotice[]): LiveFoldNotice[] {
  const seen = loadSeen();
  return notices.filter((notice) => !seen.has(`${date}:${notice.word}`));
}

/** Close these notices for good on this browser. */
export function markNoticesSeen(date: string, notices: readonly LiveFoldNotice[]): void {
  try {
    const seen = loadSeen();
    for (const notice of notices) seen.add(`${date}:${notice.word}`);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or disabled: the bubble comes back next time, which is harmless.
  }
}
