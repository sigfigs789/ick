import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  trackChatMessageBlocked,
  trackChatMessageSent,
  trackChatOpened,
  trackChatTime,
} from "../analytics";
import { CHAT_MAX_LENGTH, chatProblem, normaliseMessage, type ChatProblem } from "../game/chat";
import { handleFor } from "../game/handle";
import { loadPlayerId } from "../game/player";

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

/** The newest message id this browser has had on screen in the open room. */
export const CHAT_SEEN_KEY = "ick:chat-seen";

function loadSeen(): number | null {
  try {
    const raw = localStorage.getItem(CHAT_SEEN_KEY);
    if (raw === null) return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function saveSeen(id: number): void {
  try {
    if ((loadSeen() ?? 0) < id) localStorage.setItem(CHAT_SEEN_KEY, String(id));
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

function timeOf(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Merge a page of messages into what is shown, in id order, without repeats. */
function merge(shown: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return shown;
  const seen = new Set(shown.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return shown;
  return [...shown, ...fresh].sort((a, b) => a.id - b.id);
}

/**
 * The chat room: a small button in the corner of every page that opens one
 * shared room of short messages.
 *
 * Players appear under the same handle the leaderboard gives them, computed
 * from their id -- nobody types a name. The room is read only while it is open.
 *
 * While closed, the button carries a dot when somebody has posted since this
 * browser last had the room open. A browser that has never opened it takes the
 * room as it first finds it as read, so the dot means a new post, not a backlog.
 *
 * `lifted` raises it clear of the dev date bar, which shares the corner.
 */
export function ChatBubble({ lifted = false }: { lifted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);

  const lastId = useRef(0);
  /** What this page knows was seen, for when storage is unavailable. */
  const seenHere = useRef<number | null>(null);
  /** The newest id the last check found, to re-judge the dot against. */
  const latestKnown = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The current opening of the panel, which every chat event is tagged with. */
  const viewId = useRef("");
  /** Messages this view has put in the room, for its time reports. */
  const sentThisView = useRef(0);

  const playerId = loadPlayerId();
  const ownHandle = playerId ? handleFor(playerId) : null;

  const show = useCallback((incoming: ChatMessage[]) => {
    setMessages((shown) => {
      const next = merge(shown, incoming);
      if (next.length > 0) lastId.current = next[next.length - 1].id;
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat?after=${lastId.current}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { messages?: ChatMessage[] };
      show(data.messages ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [show]);

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

  // Opening the room reads it: everything shown counts as seen.
  useEffect(() => {
    if (!open) return;
    setUnread(false);
    if (lastId.current > 0) {
      seenHere.current = Math.max(seenHere.current ?? 0, lastId.current);
      saveSeen(lastId.current);
    }
  }, [open, messages]);

  // While closed, check now and then for a post this browser has not seen. A
  // failed check changes nothing: the dot is a nicety, never an error.
  useEffect(() => {
    if (open) return;
    const judge = () => {
      const stored = loadSeen();
      const seen = stored === null ? seenHere.current : Math.max(stored, seenHere.current ?? 0);
      if (seen === null) {
        seenHere.current = latestKnown.current;
        saveSeen(latestKnown.current);
        setUnread(false);
      } else {
        setUnread(latestKnown.current > seen);
      }
    };
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/chat?latest=1");
        if (!response.ok) return;
        const data = (await response.json()) as { latest?: unknown };
        if (cancelled || typeof data.latest !== "number") return;
        latestKnown.current = data.latest;
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
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [open]);

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

  useEffect(() => {
    if (open) inputRef.current?.focus();
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
        body: JSON.stringify({ playerId, body }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: ChatMessage;
        reason?: string;
      };
      if (response.ok && data.message) {
        show([data.message]);
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
          className="chat__panel"
          role="dialog"
          aria-label="Chat"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <header className="chat__header">
            <h2 className="chat__title">Chat</h2>
            {ownHandle && <span className="chat__self">You're {ownHandle}</span>}
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
                    className={`chat__message chat__message--notice chat__message--${message.kind}`}
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
              placeholder={playerId ? "Say something…" : "Chat needs browser storage turned on"}
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
