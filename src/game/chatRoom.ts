/**
 * The pieces of a chat room both of its views draw from: the website's bubble
 * (components/ChatBubble.tsx) and the app's chat sheet (native/). Kept here
 * rather than in either so the two cannot disagree about what a line is.
 */
import type { Reaction } from "./chat";

export interface ChatMessage {
  id: number;
  handle: string;
  body: string;
  at: string;
  /**
   * Absent for a player's message. A notice the room posted itself: "find" the
   * first time anybody banks a 9.5+ word on the puzzle, and "earlier" for the
   * line only the player who banked it after them sees (kept in this browser;
   * see game/chatNotices.ts). "top" and "tier" are notices from before they were
   * once per word. Its body already names the player, so it is shown as one
   * line of its own.
   */
  kind?: "top" | "tier" | "find" | "earlier";
  /** What a "find" or "earlier" notice is about. */
  word?: string;
  mode?: "standard" | "freeform";
  /** "Mythic" or "Legend", which the notice is colored by. */
  tier?: string;
}

const NOTICE_ICONS: Record<NonNullable<ChatMessage["kind"]>, string> = {
  top: "🥇",
  tier: "✨",
  find: "✨",
  earlier: "🔎",
};

/**
 * A Standard find is the harder one, so it never sparkles: ✨ is Freeform's. It
 * takes one of these instead, picked by the notice's id so every player sees
 * the same one on the same line: any celebration but a star or sparkle, which
 * would read as Freeform's. 💎 is kept for a Legend at 9.99 or more, and only
 * it. 🥇 is shared with the retired top-score notices, which only a few old
 * rooms still hold; 🔎 is left out, being the "earlier" line's.
 */
const STANDARD_FIND_ICONS = [
  "🔥", "👑", "⚡", "🎯", "🤯", "💥", "🚀", "🥇", "🏅", "🏆", "🕺", "💃", "🎉",
  "🎊", "🥳", "🙌", "👏", "💪", "🤩", "😎", "🎆", "🍾", "🥂", "🪅", "🎈", "🤘",
];
const TOP_LEGEND_ICON = "💎";
const TOP_LEGEND_MIN = 9.99;

/**
 * The score a find notice's body ends with: "abaci 9.99!", or "abaci 9.99" or
 * "(9.99) in standard mode" on a line posted before.
 */
export function noticeScore(body: string): number | null {
  const match = /(?:\((\d+(?:\.\d+)?)\) in (?:standard|freeform) mode| (\d+\.\d+)!?)$/.exec(body);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function noticeIcon(message: ChatMessage & { kind: NonNullable<ChatMessage["kind"]> }): string {
  if (message.kind !== "find" || message.mode !== "standard") return NOTICE_ICONS[message.kind];
  if (message.tier === "Legend" && (noticeScore(message.body) ?? 0) >= TOP_LEGEND_MIN) return TOP_LEGEND_ICON;
  return STANDARD_FIND_ICONS[message.id % STANDARD_FIND_ICONS.length];
}

/** Reactions by line id. */
export type Reactions = Record<number, Reaction[]>;

/** A room's reactions as the endpoint lists them, by line. */
export function byLine(list: unknown): Reactions | null {
  if (!Array.isArray(list)) return null;
  const out: Reactions = {};
  for (const item of list as { id?: unknown; emoji?: unknown; handles?: unknown }[]) {
    if (
      typeof item?.id !== "number" ||
      typeof item.emoji !== "string" ||
      !Array.isArray(item.handles) ||
      item.handles.length === 0
    ) {
      continue;
    }
    (out[item.id] ??= []).push({ emoji: item.emoji, handles: item.handles.map(String) });
  }
  return out;
}

/** A line's clock time, "3:07 PM" in the reader's own format. */
export function timeOf(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The newest id among `messages`, 0 for none. */
export function newestId(messages: readonly ChatMessage[]): number {
  return messages.reduce((id, m) => Math.max(id, m.id), 0);
}

/** Merge a page of messages into what is shown, in id order, without repeats. */
export function merge(shown: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return shown;
  const seen = new Set(shown.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return shown;
  return [...shown, ...fresh].sort((a, b) => a.id - b.id);
}

/**
 * The newest message id this browser has had on screen in each puzzle's room,
 * as `{ "2026-10-13": 812, ... }`. A puzzle missing from it has been read not
 * at all, so anything in its room is unread -- a new player included.
 */
export const CHAT_SEEN_KEY = "ick:chat-seen-by-puzzle";

/** How many puzzles' read marks are kept; the oldest go first. */
const SEEN_KEPT = 30;

export type Seen = Record<string, number>;

export function loadSeen(): Seen {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, id]) => typeof id === "number" && Number.isFinite(id)),
    ) as Seen;
  } catch {
    return {};
  }
}

export function saveSeen(date: string, id: number): void {
  try {
    const seen = loadSeen();
    if ((seen[date] ?? 0) >= id) return;
    seen[date] = id;
    const kept = Object.keys(seen).sort().slice(-SEEN_KEPT);
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(Object.fromEntries(kept.map((d) => [d, seen[d]]))));
  } catch {
    // Private mode: the dot falls back to this page's memory of what was seen.
  }
}

