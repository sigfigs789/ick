/**
 * Tell the chat room about a word this player just banked.
 *
 * The room posts a notice when a word is the puzzle's new top score (7.0 or
 * more), or scores 9.5 or more (see api/chat.ts and the 20261013000000 and
 * 20261014040000 migrations). Which words those are is the server's call -- only
 * it can see what everybody else has banked -- so every word banked on the live
 * puzzle at 7.0 or more is reported, priced the way the game showed it to the
 * player. Nothing under that could earn a notice, so it is not sent.
 *
 * Fire-and-forget like the leaderboard's write (see game/leaderboard.ts, post):
 * a report that never lands costs a notice, never a word.
 *
 * A 9.5+ word is always announced, so once its report has landed the chat
 * bubble is told to look straight away (see onBankedNotice) rather than on its
 * next poll -- the player sees their own notice the moment it is posted.
 */
import { earnsTopNotice, NOTICE_MIN_SCORE } from "./chat";
import { formatRarityScore } from "./dictionary";
import { modeForDate, type GameMode } from "./mode";
import { loadPlayerId } from "./player";
import type { AcceptedWord } from "./types";

/** A notice as api/chat.ts returns it; see ChatMessage in ChatBubble.tsx. */
export interface BankedNotice {
  id: number;
  handle: string;
  body: string;
  at: string;
  kind: "top" | "tier";
  tier?: string;
}

const BANKED_EVENT = "ick:chat-banked";

interface BankedDetail {
  date: string;
  /** The notice the word earned, or null when the room posted none for it. */
  message: BankedNotice | null;
}

/**
 * Call `listener` whenever a 9.5+ word's report has landed, with the puzzle it
 * was banked on and the notice it posted, if any. Returns the unsubscribe.
 */
export function onBankedNotice(listener: (date: string, message: BankedNotice | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<BankedDetail>).detail;
    if (detail) listener(detail.date, detail.message);
  };
  window.addEventListener(BANKED_EVENT, handler);
  return () => window.removeEventListener(BANKED_EVENT, handler);
}

function readNotice(data: unknown): BankedNotice | null {
  const message = (data as { message?: unknown } | null)?.message as Partial<BankedNotice> | null | undefined;
  if (!message || typeof message.id !== "number") return null;
  if (message.kind !== "top" && message.kind !== "tier") return null;
  return message as BankedNotice;
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
  const score = formatRarityScore(word.zipf, date);
  if (!earnsTopNotice(score)) return false;
  const banked = {
    date,
    mode,
    word: word.word.toLowerCase(),
    tier: word.rarity,
    score,
  };
  const announced = Number(score) >= NOTICE_MIN_SCORE;
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
        if (!announced) return;
        const data: unknown = await response.json().catch(() => null);
        window.dispatchEvent(
          new CustomEvent<BankedDetail>(BANKED_EVENT, { detail: { date, message: readNotice(data) } })
        );
      })
      .catch(() => {});
    return true;
  } catch {
    // Announcing a word must never be able to break the move that earned it.
    return false;
  }
}
