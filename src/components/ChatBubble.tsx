import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  trackChatMessageBlocked,
  trackChatMessageSent,
  trackChatOpened,
  trackChatTime,
} from "../analytics";
import { CHAT_MAX_LENGTH, chatProblem, normaliseMessage, type ChatProblem } from "../game/chat";
import { onBankedNotice } from "../game/chatNotices";
import { addDays, formatDateLabel, todayDateString } from "../game/date";
import { dropForDate, FIRST_PUZZLE } from "../game/drop";
import { handleFor } from "../game/handle";
import { pageCache } from "../game/pageCache";
import { loadPlayerId } from "../game/player";
import { onViewedPuzzle, viewedPuzzle } from "../game/viewedPuzzle";

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
  /** A notice's tier as the game showed it, e.g. "Mythic"; absent on older notices. */
  tier?: string;
}

/**
 * The extra class a notice wears. A 9.5+ line takes its tier's colours, so it
 * reads apart from the top score's; a top score keeps the room's own.
 */
function noticeClass(message: ChatMessage): string {
  if (message.kind !== "tier") return "";
  if (message.tier === "Legend") return " chat__message--legend";
  if (message.tier === "Mythic") return " chat__message--mythic";
  return "";
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
const roomCache = pageCache<{ messages: ChatMessage[]; lastId: number }>();

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
 * a player who has never opened the chat included.
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
  const [unread, setUnread] = useState(false);

  const lastId = useRef(0);
  /** The room `messages` and `lastId` belong to, so a late answer for another is dropped. */
  const shownDate = useRef(date);
  /** What this page knows was seen, for when storage is unavailable. */
  const seenHere = useRef<Seen>({});
  /** The newest id the last check found, to re-judge the dot against. */
  const latestKnown = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The current opening of the panel, which every chat event is tagged with. */
  const viewId = useRef("");
  /** Messages this view has put in the room, for its time reports. */
  const sentThisView = useRef(0);

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
    setLoaded(kept !== undefined);
    setLoadFailed(false);
  }, [date]);

  const show = useCallback((room: string, incoming: ChatMessage[]) => {
    if (room !== shownDate.current) return;
    setMessages((shown) => {
      const next = merge(shown, incoming);
      if (next.length > 0) lastId.current = next[next.length - 1].id;
      roomCache.set(room, { messages: next, lastId: lastId.current });
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    const room = date;
    try {
      const response = await fetch(`/api/chat?date=${room}&after=${lastId.current}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { messages?: ChatMessage[] };
      if (room !== shownDate.current) return;
      show(room, data.messages ?? []);
      setLoadFailed(false);
    } catch {
      if (room === shownDate.current) setLoadFailed(true);
    } finally {
      if (room === shownDate.current) setLoaded(true);
    }
  }, [date, show]);

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
    // A 9.5+ word this player just banked: show its notice now and look for
    // anything else, rather than waiting for the next poll.
    const offBanked = onBankedNotice((room, message) => {
      if (room !== shownDate.current) return;
      if (message) show(room, [message]);
      void poll();
    });
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      offBanked();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, poll, show]);

  // Having a room open reads it: everything shown counts as seen.
  useEffect(() => {
    if (!open || shownDate.current !== date) return;
    if (date === gameDate) setUnread(false);
    if (lastId.current > 0) {
      seenHere.current[date] = Math.max(seenHere.current[date] ?? 0, lastId.current);
      saveSeen(date, lastId.current);
    }
  }, [open, messages, date, gameDate]);

  // While closed, check now and then for a post in the game's puzzle's room that
  // this browser has not seen. A failed check changes nothing: the dot is a
  // nicety, never an error.
  useEffect(() => {
    if (open) return;
    const room = gameDate;
    latestKnown.current = 0;
    const judge = () => {
      const seen = Math.max(loadSeen()[room] ?? 0, seenHere.current[room] ?? 0);
      setUnread(latestKnown.current > seen);
    };
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/chat?date=${room}&latest=1`);
        if (!response.ok) return;
        const data = (await response.json()) as { latest?: unknown };
        if (cancelled || typeof data.latest !== "number") return;
        // Never below what this check already knows: the CDN can answer with a
        // newest id from before a notice this page was handed directly.
        latestKnown.current = Math.max(latestKnown.current, data.latest);
        judge();
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
      if (event.key === CHAT_SEEN_KEY && latestKnown.current > 0) judge();
    };
    // A 9.5+ word this player just banked: dot its notice now, not on the next check.
    const offBanked = onBankedNotice((banked, message) => {
      if (banked !== room) return;
      if (message) {
        latestKnown.current = Math.max(latestKnown.current, message.id);
        judge();
      }
      void check();
    });
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      stop();
      offBanked();
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
    buttonRef.current?.focus();
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
            if (event.key === "Escape") close();
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
              messages.map((message) =>
                message.kind ? (
                  <li
                    key={message.id}
                    className={`chat__message chat__message--notice chat__message--${message.kind}${noticeClass(message)}`}
                  >
                    <span className="chat__body">
                      <span className="chat__notice-icon" aria-hidden="true">
                        {NOTICE_ICONS[message.kind]}
                      </span>{" "}
                      {message.body}
                    </span>
                    <time className="chat__time" dateTime={message.at}>
                      {timeOf(message.at)}
                    </time>
                  </li>
                ) : (
                <li
                  key={message.id}
                  className={`chat__message${message.handle === ownHandle ? " chat__message--own" : ""}`}
                >
                  <span className="chat__meta">
                    <span className="chat__handle">{message.handle}</span>
                    <time className="chat__time" dateTime={message.at}>
                      {timeOf(message.at)}
                    </time>
                  </span>
                  <span className="chat__body">{message.body}</span>
                </li>
                )
              )
            )}
          </ol>
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
        {unread && !open && <span className="chat__dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
