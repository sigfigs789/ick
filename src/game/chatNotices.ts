/**
 * Tell the chat room about a word this player just banked.
 *
 * The room posts a notice when a word is the best anybody has banked on the
 * puzzle so far, or scores 9.5 or more (see api/chat.ts and the 20261013000000
 * and 20261014040000 migrations). Which words
 * those are is the server's call -- only it can see what everybody else has
 * banked -- so every word banked on the live puzzle is reported, priced the way
 * the game showed it to the player.
 *
 * Fire-and-forget like the leaderboard's write (see game/leaderboard.ts, post):
 * a report that never lands costs a notice, never a word.
 */
import { formatRarityScore } from "./dictionary";
import { modeForDate, type GameMode } from "./mode";
import { loadPlayerId } from "./player";
import type { AcceptedWord } from "./types";

export function reportBankedWord(options: {
  date: string;
  /** Only the live puzzle is announced; an archive day sends nothing. */
  isToday: boolean;
  word: AcceptedWord;
  /** The rules the word was banked under; off the progress record, as submitScore takes it. */
  mode?: GameMode;
  playerId?: string | null;
}): boolean {
  const { date, isToday, word } = options;
  const mode = options.mode ?? modeForDate(date);
  const playerId = options.playerId ?? loadPlayerId();
  if (!playerId || !isToday) return false;
  const banked = {
    date,
    mode,
    word: word.word.toLowerCase(),
    tier: word.rarity,
    score: formatRarityScore(word.zipf, date),
  };
  try {
    void Promise.resolve(
      fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, banked }),
        keepalive: true,
      })
    ).catch(() => {});
    return true;
  } catch {
    // Announcing a word must never be able to break the move that earned it.
    return false;
  }
}
