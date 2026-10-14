import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  trackChatMessageBlocked,
  trackChatMessageSent,
  trackChatOpened,
  trackChatTime,
} from "../analytics";
import {
  CHAT_MAX_LENGTH,
  chatProblem,
  isReactionEmoji,
  normaliseMessage,
  toggled,
  type ChatProblem,
  type Reaction,
} from "../game/chat";
import { playChatMessage, playChatNotice } from "../audio/sound";
import { onBankedNotice } from "../game/chatNotices";
import { addDays, formatDateLabel, todayDateString } from "../game/date";
import { dropForDate, FIRST_PUZZLE } from "../game/drop";
import { handleFor } from "../game/handle";
import { pageCache } from "../game/pageCache";
import { loadPlayerId } from "../game/player";
import { onViewedPuzzle, viewedPuzzle } from "../game/viewedPuzzle";
import {
  ReactButton,
  ReactionChips,
  ReactionPicker,
  ReactionTray,
} from "./ChatReactions";
import { useHold } from "../hooks/useHold";

/**
 * How often an open room asks for new messages.
 *
 * Polled rather than pushed -- see api/chat.ts for why. Four seconds reads as
 * live for a room this size, and the endpoint's two-second CDN cache means a
 * room full of open bubbles still costs one query every couple of seconds.
 * Nothing is polled while the bubble is closed or the tab is hidden.
 */
export const CHAT_POLL_MS = 4000;

/**
 * How often a closed bubble checks whether anything new was posted. It asks
 * only for the newest id, a URL every closed bubble shares and the CDN holds for
 * fifteen seconds, so this costs next to nothing. Not polled while hidden.
 */
export const CHAT_CHECK_MS = 30_000;

/**
 * The newest message id this browser has had on screen in each puzzle's room,
 * as `{ "2026-10-13": 812, ... }`. A puzzle missing from it has been read not
 * at all, so anything in its room is unread -- a new player included.
 */
export const CHAT_SEEN_KEY = "ick:chat-seen-by-puzzle";

/** How many puzzles' read marks are kept; the oldest go first. */
const SEEN_KEPT = 30;

type Seen = Record<string, number>;

function loadSeen(): Seen {
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

function saveSeen(date: string, id: number): void {
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

/** A hide/show flicker is not time spent; see game/sessionTime.ts. */
const MIN_SEGMENT_MS = 1000;
/** A stretch the browser never ended (a slept laptop) is clamped, not counted whole. */
const MAX_SEGMENT_MS = 30 * 60 * 1000;

function newViewId(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface ChatMessage {
  id: number;
  handle: string;
  body: string;
  at: string;
  /**
   * Absent for a player's message. A notice the room posted itself: "top" when
   * somebody banked the puzzle's new top score, "tier" for a 9.5+ word. Its body
   * already names the player, so it is shown as one line of its own.
   */
  kind?: "top" | "tier";
}

const NOTICE_ICONS: Record<NonNullable<ChatMessage["kind"]>, string> = {
  top: "🏆",
  tier: "✨",
};

const PROBLEM_TEXT: Record<ChatProblem | "rate-limited" | "unavailable", string> = {
  empty: "",
  "too-long": `Keep it under ${CHAT_MAX_LENGTH} characters.`,
  profane: "Let's keep it clean. Try saying that another way.",
  "rate-limited": "Slow down a little. Try again in a few seconds.",
  unavailable: "Couldn't send. Try again in a moment.",
};

const REACT_PROBLEM_TEXT: Record<"full" | "missing" | "rate-limited" | "unavailable", string> = {
  full: "That message can't take any more reactions.",
  missing: "That message is gone.",
  "rate-limited": "Slow down a little. Try again in a few seconds.",
  unavailable: "Couldn't react. Try again in a moment.",
};

/**
 * How long a reaction the player just made outranks what the room's polls say
 * about that line. A poll can be a couple of seconds stale from the CDN, and
 * would otherwise flick the chip back before it catches up.
 */
const OWN_REACTION_HOLD_MS = 8000;

/** Reactions by line id. */
type Reactions = Record<number, Reaction[]>;

/** A room's reactions as the endpoint lists them, by line. */
function byLine(list: unknown): Reactions | null {
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

/**
 * What the dot is about: a player's message (blue) or only notices the room
 * posted itself (green). A player's message wins when both are unread.
 */
type Unread = "message" | "notice" | null;

/** The newest ids a closed bubble's check found; see api/chat.ts. */
interface Latest {
  latest: number;
  message: number;
  notice: number;
}

const NO_LATEST: Latest = { latest: 0, message: 0, notice: 0 };

/**
 * Which kind of post `latest` holds after `seen`. A server from before the
 * split answers only `latest`, which is taken for a player's message.
 */
function unreadKind({ latest, message, notice }: Latest, seen: number): Unread {
  if (message > seen) return "message";
  if (notice > seen) return "notice";
  return latest > seen ? "message" : null;
}

function timeOf(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Every room read this visit: its messages and the newest id among them.
 *
 * Stepping back to a room shows it straight away and asks only for what came
 * after it (see game/pageCache.ts) -- a room is the one view here that can be
 * read incrementally, so a return costs a request for nothing new rather than
 * the whole room again.
 */
const roomCache = pageCache<{ messages: ChatMessage[]; lastId: number; reactions: Reactions }>();

/** Merge a page of messages into what is shown, in id order, without repeats. */
function merge(shown: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return shown;
  const seen = new Set(shown.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return shown;
  return [...shown, ...fresh].sort((a, b) => a.id - b.id);
}

/**
 * The chat: a small button in the corner of every page that opens a room of
 * short messages. There is a room per puzzle; the panel opens on the puzzle the
 * game is showing, names it by its drop, and steps back and forward through the
 * puzzles the way the game does.
 *
 * Players appear under the same handle the leaderboard gives them, computed
 * from their id -- nobody types a name. A room is read only while it is open.
 *
 * While closed, the button carries a dot when the room of the puzzle the game
 * is on has a message this browser has not had on screen -- for everybody,
 * a player who has never opened the chat included. It is blue for a player's
 * message and green when all that is new is the room's own score notices, and
 * a post that arrives while the page is open plays a chime to match.
 *
 * `lifted` raises it clear of the dev date bar, which shares the corner.
 */
export function ChatBubble({ lifted = false }: { lifted?: boolean }) {
  const [open, setOpen] = useState(false);
  /** The puzzle whose room the panel shows. */
  const [date, setDate] = useState(viewedPuzzle);
  /** The puzzle the game is on, which the dot is about. */
  const [gameDate, setGameDate] = useState(viewedPuzzle);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState<Unread>(null);
  const [reactions, setReactions] = useState<Reactions>({});
  /** The line whose reaction tray is open. */
  const [reacting, setReacting] = useState<number | null>(null);
  /** Whether that line's tray has given way to the full picker. */
  const [picking, setPicking] = useState(false);

  const lastId = useRef(0);
  /** The room `messages` and `lastId` belong to, so a late answer for another is dropped. */
  const shownDate = useRef(date);
  /** What this page knows was seen, for when storage is unavailable. */
  const seenHere = useRef<Seen>({});
  /** The newest ids the last check found, to re-judge the dot against. */
  const latestKnown = useRef<Latest>(NO_LATEST);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The current opening of the panel, which every chat event is tagged with. */
  const viewId = useRef("");
  /** Messages this view has put in the room, for its time reports. */
  const sentThisView = useRef(0);
  /** Lines the player reacted to lately, and until when their own view stands. */
  const ownUntil = useRef<Record<number, number>>({});
  /** The newest reaction request per line, so an older answer cannot undo a newer tap. */
  const reactSeq = useRef<Record<number, number>>({});

  const playerId = loadPlayerId();
  const ownHandle = playerId ? handleFor(playerId) : null;

  const today = todayDateString();
  const canGoBack = date > FIRST_PUZZLE;
  const canGoForward = date < today;

  useEffect(() => onViewedPuzzle(setGameDate), []);

  // Opening the chat goes to the puzzle the game is on.
  useEffect(() => {
    if (open) setDate(viewedPuzzle());
  }, [open]);

  // Another puzzle is another room: start it from what this visit has read of
  // it, or empty if nothing yet.
  useEffect(() => {
    if (shownDate.current === date) return;
    shownDate.current = date;
    const kept = roomCache.get(date);
    lastId.current = kept?.lastId ?? 0;
    setMessages(kept?.messages ?? []);
    setReactions(kept?.reactions ?? {});
    setReacting(null);
    setPicking(false);
    setLoaded(kept !== undefined);
    setLoadFailed(false);
  }, [date]);

  /**
   * Merge messages into the room. Only a poll's answer moves `lastId`: a message
   * put in by hand (one this player sent, or a notice their word earned) can
   * land just after another player's that no poll has fetched yet, and moving
   * the cursor past it would skip that message for good.
   */
  const show = useCallback((room: string, incoming: ChatMessage[], polled = false) => {
    if (room !== shownDate.current) return;
    if (polled) for (const m of incoming) lastId.current = Math.max(lastId.current, m.id);
    setMessages((shown) => {
      const next = merge(shown, incoming);
      roomCache.set(room, {
        messages: next,
        lastId: lastId.current,
        reactions: roomCache.get(room)?.reactions ?? {},
      });
      return next;
    });
  }, []);

  /**
   * Take the room's reactions as a poll found them -- except on a line the
   * player has just reacted to, where what they did stands a little longer.
   * `line` instead replaces one line's alone, from the answer to a reaction.
   */
  const showReactions = useCallback((room: string, found: Reactions, line?: number) => {
    if (room !== shownDate.current) return;
    setReactions((shown) => {
      let next: Reactions;
      if (line !== undefined) {
        next = { ...shown, [line]: found[line] ?? [] };
      } else {
        next = { ...found };
        const now = Date.now();
        for (const [id, until] of Object.entries(ownUntil.current)) {
          if (until > now) next[Number(id)] = shown[Number(id)] ?? [];
          else delete ownUntil.current[Number(id)];
        }
      }
      const kept = roomCache.get(room);
      if (kept) roomCache.set(room, { ...kept, reactions: next });
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    const room = date;
    try {
      const response = await fetch(`/api/chat?date=${room}&after=${lastId.current}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { messages?: ChatMessage[]; reactions?: unknown };
      if (room !== shownDate.current) return;
      show(room, data.messages ?? [], true);
      const found = byLine(data.reactions);
      if (found) showReactions(room, found);
      setLoadFailed(false);
    } catch {
      if (room === shownDate.current) setLoadFailed(true);
    } finally {
      if (room === shownDate.current) setLoaded(true);
    }
  }, [date, show, showReactions]);

  // A word this player just banked earned a notice: put it in the open room now
  // rather than on the next poll, the way a sent message is.
  useEffect(() => {
    if (!open) return;
    return onBankedNotice((room, notice) => show(room, [notice]));
  }, [open, show]);

  // Poll while open and visible. Reopening starts from where the room was left,
  // so a closed-and-reopened bubble picks up only what it missed.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      void poll();
      timer = setInterval(() => void poll(), CHAT_POLL_MS);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, poll]);

  // Having a room open reads it: everything shown counts as seen.
  useEffect(() => {
    if (!open || shownDate.current !== date) return;
    if (date === gameDate) setUnread(null);
    const newest = messages.length > 0 ? messages[messages.length - 1].id : 0;
    if (newest > 0) {
      seenHere.current[date] = Math.max(seenHere.current[date] ?? 0, newest);
      saveSeen(date, newest);
    }
  }, [open, messages, date, gameDate]);

  // While closed, check now and then for a post in the game's puzzle's room that
  // this browser has not seen. A failed check changes nothing: the dot is a
  // nicety, never an error.
  useEffect(() => {
    if (open) return;
    const room = gameDate;
    latestKnown.current = NO_LATEST;
    /**
     * The newest id this run of checks already knew of, so only a post that
     * lands after the first check chimes -- not what was waiting on arrival,
     * nor what was read with the panel open.
     */
    let heard: number | null = null;
    /**
     * The newest notice this player's own words earned in the room, which the
     * check's cached answer can be a few seconds behind.
     */
    let ownNotice = 0;
    const seenNow = () => Math.max(loadSeen()[room] ?? 0, seenHere.current[room] ?? 0);
    const judge = () => setUnread(unreadKind(latestKnown.current, seenNow()));
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/chat?date=${room}&latest=1`);
        if (!response.ok) return;
        const data = (await response.json()) as { latest?: unknown; message?: unknown; notice?: unknown };
        if (cancelled || typeof data.latest !== "number") return;
        const found: Latest = {
          latest: Math.max(data.latest, ownNotice),
          message: typeof data.message === "number" ? data.message : 0,
          notice: Math.max(typeof data.notice === "number" ? data.notice : 0, ownNotice),
        };
        latestKnown.current = found;
        judge();
        if (heard !== null && found.latest > heard) {
          const fresh = unreadKind(found, Math.max(heard, seenNow()));
          if (fresh === "message") playChatMessage();
          else if (fresh === "notice") playChatNotice();
        }
        heard = Math.max(heard ?? 0, found.latest);
      } catch {
        // Offline or no endpoint (vite dev): leave the dot as it is.
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      void check();
      timer = setInterval(() => void check(), CHAT_CHECK_MS);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    // Another tab opening the room clears the dot here too.
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHAT_SEEN_KEY && latestKnown.current.latest > 0) judge();
    };
    // A word this player just banked earned a notice: dot it now rather than on
    // the next check. Counted as heard, so no chime -- the player is the one who
    // banked it, and the game has just played its own sound for the word.
    const offNotice = onBankedNotice((date, posted) => {
      if (date !== room) return;
      ownNotice = Math.max(ownNotice, posted.id);
      const known = latestKnown.current;
      latestKnown.current = {
        latest: Math.max(known.latest, ownNotice),
        message: known.message,
        notice: Math.max(known.notice, ownNotice),
      };
      if (heard !== null) heard = Math.max(heard, ownNotice);
      judge();
    });
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      offNotice();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [open, gameDate]);

  // Time with the panel open, counted while the page is visible and reported the
  // way session_time is: on every hide as well as on close, because a phone
  // backgrounds a tab far more often than anybody closes a panel. Each report
  // carries the running total and the part that is new since the last one.
  useEffect(() => {
    if (!open) return;
    const view = newViewId();
    viewId.current = view;
    sentThisView.current = 0;
    trackChatOpened(view);

    let visibleMs = 0;
    let reportedMs = 0;
    let reports = 0;
    let resumedAt: number | null = document.visibilityState === "hidden" ? null : Date.now();

    const bank = () => {
      if (resumedAt === null) return;
      visibleMs += Math.min(Date.now() - resumedAt, MAX_SEGMENT_MS);
      resumedAt = null;
    };
    const report = (closed: boolean) => {
      const segmentMs = visibleMs - reportedMs;
      if (segmentMs < MIN_SEGMENT_MS && !(closed && reports === 0 && visibleMs > 0)) return;
      reports += 1;
      reportedMs = visibleMs;
      trackChatTime({
        viewId: view,
        visibleMs,
        segmentMs,
        sent: sentThisView.current,
        closed,
        reportNumber: reports,
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        bank();
        report(false);
      } else if (resumedAt === null) {
        resumedAt = Date.now();
      }
    };
    const onPageHide = () => {
      bank();
      report(false);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      bank();
      report(true);
    };
  }, [open]);

  // Keep the newest message in view as the room grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  // Focus the panel, not the input: focusing the input would raise the
  // on-screen keyboard and cover the chat before the player chooses to type.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setReacting(null);
    setPicking(false);
    buttonRef.current?.focus();
  }

  function closeReactions() {
    setReacting(null);
    setPicking(false);
  }

  /** Open or close `id`'s reaction tray. */
  function trayFor(id: number) {
    if (!ownHandle) return;
    setPicking(false);
    setReacting((open) => (open === id ? null : id));
  }

  /** Add the player's `emoji` to line `id`, or take it back if it is there. */
  async function react(id: number, emoji: string) {
    closeReactions();
    if (!playerId || !ownHandle || !isReactionEmoji(emoji)) return;
    const room = date;
    const before = reactions[id] ?? [];
    const on = !before.some((r) => r.emoji === emoji && r.handles.includes(ownHandle));
    const seq = (reactSeq.current[id] ?? 0) + 1;
    reactSeq.current[id] = seq;
    ownUntil.current[id] = Date.now() + OWN_REACTION_HOLD_MS;
    showReactions(room, { [id]: toggled(before, emoji, ownHandle, on) }, id);
    setNotice("");

    const fail = (reason: keyof typeof REACT_PROBLEM_TEXT) => {
      if (reactSeq.current[id] !== seq) return;
      showReactions(room, { [id]: before }, id);
      if (room === shownDate.current) setNotice(REACT_PROBLEM_TEXT[reason]);
    };
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, date: room, react: { id, emoji, on } }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reactions?: unknown;
        reason?: string;
      };
      if (response.ok && Array.isArray(data.reactions)) {
        if (reactSeq.current[id] !== seq) return;
        ownUntil.current[id] = Date.now() + OWN_REACTION_HOLD_MS;
        const line = byLine(
          (data.reactions as object[]).map((reaction) => ({ ...reaction, id })),
        );
        showReactions(room, line ?? {}, id);
      } else if (
        data.reason === "full" ||
        data.reason === "missing" ||
        data.reason === "rate-limited"
      ) {
        fail(data.reason);
      } else {
        fail("unavailable");
      }
    } catch {
      fail("unavailable");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || !playerId) return;
    const body = normaliseMessage(draft);
    const problem = chatProblem(body);
    if (problem) {
      setNotice(PROBLEM_TEXT[problem]);
      if (problem !== "empty") trackChatMessageBlocked(viewId.current, problem);
      return;
    }
    setSending(true);
    setNotice("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, body, date }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: ChatMessage;
        reason?: string;
      };
      if (response.ok && data.message) {
        show(date, [data.message]);
        setDraft("");
        sentThisView.current += 1;
        trackChatMessageSent(viewId.current, body.length);
      } else if (data.reason === "profane" || data.reason === "too-long" || data.reason === "rate-limited") {
        setNotice(PROBLEM_TEXT[data.reason]);
        trackChatMessageBlocked(viewId.current, data.reason);
      } else {
        setNotice(PROBLEM_TEXT.unavailable);
        trackChatMessageBlocked(viewId.current, "unavailable");
      }
    } catch {
      setNotice(PROBLEM_TEXT.unavailable);
      trackChatMessageBlocked(viewId.current, "unavailable");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className={`chat${lifted ? " chat--lifted" : ""}`}>
      {open && (
        <section
          ref={panelRef}
          tabIndex={-1}
          className="chat__panel"
          role="dialog"
          aria-label="Chat"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (reacting !== null) closeReactions();
            else close();
          }}
        >
          <header className="chat__header">
            <button
              type="button"
              className="chat__step"
              aria-label="Previous puzzle's chat"
              disabled={!canGoBack}
              onClick={() => setDate(addDays(date, -1))}
            >
              ‹
            </button>
            <h2 className="chat__title" aria-label={`Chat for ${formatDateLabel(date)}'s drop`}>
              {dropForDate(date)}
            </h2>
            <button
              type="button"
              className="chat__step"
              aria-label="Next puzzle's chat"
              disabled={!canGoForward}
              onClick={() => setDate(addDays(date, 1))}
            >
              ›
            </button>
            <button type="button" className="chat__close" aria-label="Close chat" onClick={close}>
              ×
            </button>
          </header>
          <ol className="chat__list" ref={listRef} aria-live="polite">
            {!loaded ? (
              <li className="chat__empty">Loading…</li>
            ) : messages.length === 0 ? (
              <li className="chat__empty">
                {loadFailed ? "Couldn't load the chat." : "No messages yet. Say hello!"}
              </li>
            ) : (
              messages.map((message) => (
                <ChatLine
                  key={message.id}
                  message={message}
                  own={message.handle === ownHandle}
                  ownHandle={ownHandle}
                  reactions={reactions[message.id] ?? []}
                  trayOpen={reacting === message.id && !picking}
                  onTray={() => trayFor(message.id)}
                  onReact={(emoji) => void react(message.id, emoji)}
                  onMore={() => setPicking(true)}
                />
              ))
            )}
          </ol>
          {reacting !== null && picking && (
            <ReactionPicker
              onPick={(emoji) => void react(reacting, emoji)}
              onClose={closeReactions}
            />
          )}
          {notice && (
            <p className="chat__notice" role="alert">
              {notice}
            </p>
          )}
          <form className="chat__form" onSubmit={send}>
            <input
              ref={inputRef}
              className="chat__input"
              type="text"
              value={draft}
              maxLength={CHAT_MAX_LENGTH}
              placeholder={
                playerId ? `Say something as ${ownHandle}…` : "Chat needs browser storage turned on"
              }
              aria-label="Message"
              disabled={!playerId}
              onChange={(event) => {
                setDraft(event.target.value);
                if (notice) setNotice("");
              }}
            />
            <button
              type="submit"
              className="chat__send"
              disabled={!playerId || sending || draft.trim() === ""}
            >
              Send
            </button>
          </form>
        </section>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="chat__toggle"
        aria-label={open ? "Close chat" : unread ? "Open chat, new messages" : "Open chat"}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            fill="currentColor"
          />
        </svg>
        {unread && !open && <span className={`chat__dot chat__dot--${unread}`} aria-hidden="true" />}
      </button>
    </div>
  );
}

/**
 * One line of the room: a player's message or a notice, with its reactions
 * under it. Reacting is the button beside it, or holding the line down.
 */
function ChatLine({
  message,
  own,
  ownHandle,
  reactions,
  trayOpen,
  onTray,
  onReact,
  onMore,
}: {
  message: ChatMessage;
  own: boolean;
  ownHandle: string | null;
  reactions: Reaction[];
  trayOpen: boolean;
  onTray: () => void;
  onReact: (emoji: string) => void;
  onMore: () => void;
}) {
  const hold = useHold(onTray);
  const canReact = ownHandle !== null;
  const className = message.kind
    ? `chat__message chat__message--notice chat__message--${message.kind}`
    : `chat__message${own ? " chat__message--own" : ""}`;
  return (
    <li className={`${className}${trayOpen ? " chat__message--reacting" : ""}`} {...(canReact ? hold : {})}>
      {message.kind ? (
        <>
          <span className="chat__body">
            <span className="chat__notice-icon" aria-hidden="true">
              {NOTICE_ICONS[message.kind]}
            </span>{" "}
            {message.body}
          </span>
          <time className="chat__time" dateTime={message.at}>
            {timeOf(message.at)}
          </time>
        </>
      ) : (
        <>
          <span className="chat__meta">
            <span className="chat__handle">{message.handle}</span>
            <time className="chat__time" dateTime={message.at}>
              {timeOf(message.at)}
            </time>
          </span>
          <span className="chat__body">{message.body}</span>
        </>
      )}
      {canReact && <ReactButton open={trayOpen} onClick={onTray} />}
      <ReactionChips reactions={reactions} ownHandle={ownHandle} disabled={!canReact} onToggle={onReact} />
      {trayOpen && <ReactionTray onPick={onReact} onMore={onMore} />}
    </li>
  );
}
