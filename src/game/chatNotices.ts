/**
 * Tell the chat room about a word this player just banked.
 *
 * The room posts a notice the first time anybody banks a word scoring 9.5 or
 * more on a puzzle (see api/chat.ts and the 20261014040000 migration). Whether
 * this player is the first is the server's call -- only it can see what
 * everybody else has banked -- so every Mythic or Legend word banked on the live
 * puzzle is reported, priced the way the game showed it to the player.
 *
 * When somebody got there first, the answer is a line for this player alone
 * ("StormyFox47 discovered quokka earlier"). The room never shows it to anybody,
 * so it is kept here, in this browser, and the chat bubble shows it among the
 * room's messages (see `privateNotices`).
 *
 * Fire-and-forget like the leaderboard's write (see game/leaderboard.ts, post):
 * a report that never lands costs a notice, never a word.
 *
 * When the word does earn a notice, the endpoint answers with it, and it is
 * handed on to the chat (see `onBankedNotice`) so the bubble shows it at once
 * rather than on its next check. No delay is needed first: the endpoint answers
 * only after `chat_find` has committed the row, and asking the room again would
 * meet the CDN's cached copy of it (see api/chat.ts) more often than not.
 */
import { earnsNotice } from "./chat";
import { formatRarityScore } from "./dictionary";
import { modeForDate, type GameMode } from "./mode";
import { loadPlayerId } from "./player";
import type { AcceptedWord } from "./types";

interface NoticeFields {
  id: number;
  handle: string;
  body: string;
  at: string;
  word: string;
  mode: GameMode;
  tier: string;
}

/** The room's notice for a word this player banked first; see ChatBubble's ChatMessage. */
export interface BankedNotice extends NoticeFields {
  kind: "find";
}

/** A line only this player is shown: somebody banked their word first. */
export interface PrivateNotice extends NoticeFields {
  kind: "earlier";
}

/** This browser's "earlier" lines, by puzzle: `{ "2026-10-14": [notice, ...] }`. */
export const CHAT_PRIVATE_KEY = "ick:chat-private-notices";

/** Fired on window when a new private line is kept, with the puzzle as `detail`. */
export const CHAT_PRIVATE_EVENT = "ick:chat-private-notice";

/** How many puzzles' lines are kept; the oldest go first. */
const PRIVATE_KEPT = 30;

function isNotice(value: unknown): value is BankedNotice | PrivateNotice {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    (n.kind === "find" || n.kind === "earlier") &&
    typeof n.id === "number" &&
    typeof n.handle === "string" &&
    typeof n.body === "string" &&
    typeof n.at === "string" &&
    typeof n.word === "string" &&
    (n.mode === "standard" || n.mode === "freeform") &&
    typeof n.tier === "string"
  );
}

function isPrivateNotice(value: unknown): value is PrivateNotice {
  return isNotice(value) && value.kind === "earlier";
}

function loadAll(): Record<string, PrivateNotice[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHAT_PRIVATE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([date, list]) => [
        date,
        Array.isArray(list) ? list.filter(isPrivateNotice) : [],
      ]),
    );
  } catch {
    return {};
  }
}

/** The lines only this player was shown in puzzle `date`'s room, oldest first. */
export function privateNotices(date: string): PrivateNotice[] {
  return loadAll()[date] ?? [];
}

/** Keep one line for its puzzle's room, and tell an open bubble about it. */
export function keepPrivateNotice(date: string, notice: PrivateNotice): void {
  try {
    const all = loadAll();
    const list = all[date] ?? [];
    if (list.some((n) => n.id === notice.id)) return;
    all[date] = [...list, notice].sort((a, b) => a.id - b.id);
    const kept = Object.keys(all).sort().slice(-PRIVATE_KEPT);
    localStorage.setItem(CHAT_PRIVATE_KEY, JSON.stringify(Object.fromEntries(kept.map((d) => [d, all[d]]))));
  } catch {
    // Private mode: the line is lost, the word is not.
    return;
  }
  window.dispatchEvent(new CustomEvent(CHAT_PRIVATE_EVENT, { detail: date }));
}

const listeners = new Set<(date: string, notice: BankedNotice) => void>();

/** Called with the puzzle and the room's notice whenever a word this player banks first earns one. */
export function onBankedNotice(listener: (date: string, notice: BankedNotice) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  // Nothing under Mythic is announced, so there is nothing to ask.
  if (!earnsNotice(banked)) return false;
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
        const { message } = (await response.json()) as { message?: unknown };
        if (!isNotice(message)) return;
        // The room's notice goes straight to the chat; a line for this player
        // alone is kept in this browser.
        if (message.kind === "earlier") keepPrivateNotice(date, message);
        else for (const listener of listeners) listener(date, message);
      })
      .catch(() => {});
    return true;
  } catch {
    // Announcing a word must never be able to break the move that earned it.
    return false;
  }
}
