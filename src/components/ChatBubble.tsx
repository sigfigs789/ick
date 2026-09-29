import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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

export interface ChatMessage {
  id: number;
  handle: string;
  body: string;
  at: string;
}

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

  const lastId = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
      } else if (data.reason === "profane" || data.reason === "too-long" || data.reason === "rate-limited") {
        setNotice(PROBLEM_TEXT[data.reason]);
      } else {
        setNotice(PROBLEM_TEXT.unavailable);
      }
    } catch {
      setNotice(PROBLEM_TEXT.unavailable);
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
              messages.map((message) => (
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
              ))
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
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
