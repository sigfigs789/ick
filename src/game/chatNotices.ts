/**
 * Tell the chat room about a word this player just banked.
 *
 * The room posts a notice when a word is the puzzle's new top score, or scores
 * 9.5 or more (see api/chat.ts and the 20261013000000 migration). Which words
 * those are is the server's call -- only it can see what everybody else has
 * banked -- so every word banked on the live puzzle is reported, priced the way
 * the game showed it to the player.
 *
 * Fire-and-forget like the leaderboard's write (see game/leaderboard.ts, post):
 * a report that never lands costs a notice, never a word.
 *
 * When the word does earn a notice, the endpoint answers with it, and it is
 * handed on to the chat (see `onBankedNotice`) so the bubble shows it at once
 * rather than on its next check. No delay is needed first: the endpoint answers
 * only after `chat_bank` has committed the row, and asking the room again would
 * meet the CDN's cached copy of it (see api/chat.ts) more often than not.
 */
import { formatRarityScore } from "./dictionary";
import { modeForDate, type GameMode } from "./mode";
import { loadPlayerId } from "./player";
import type { AcceptedWord } from "./types";

/** A notice the room posted for this player's word, as api/chat.ts answers it. */
export interface BankedNotice {
  id: number;
  handle: string;
  body: string;
  at: string;
  kind: "top" | "tier";
}

const listeners = new Set<(date: string, notice: BankedNotice) => void>();

/** Called with the puzzle and the notice whenever a word this player banked earns one. */
export function onBankedNotice(listener: (date: string, notice: BankedNotice) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readNotice(data: unknown): BankedNotice | null {
  const message = (data as { message?: unknown } | null)?.message;
  if (!message || typeof message !== "object") return null;
  const { id, handle, body, at, kind } = message as Record<string, unknown>;
  if (typeof id !== "number" || typeof handle !== "string" || typeof body !== "string") return null;
  if (typeof at !== "string" || (kind !== "top" && kind !== "tier")) return null;
  return { id, handle, body, at, kind };
}

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
    )
      .then(async (response) => {
        // 201 is a notice posted; 202 is a word that earned none.
        if (response?.status !== 201) return;
        const notice = readNotice(await response.json());
        if (notice) for (const listener of listeners) listener(date, notice);
      })
      .catch(() => {});
    return true;
  } catch {
    // Announcing a word must never be able to break the move that earned it.
    return false;
  }
}
