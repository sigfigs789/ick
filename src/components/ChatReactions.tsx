import { lazy, Suspense, useEffect, useRef } from "react";
import { QUICK_REACTIONS, reactorsLabel, type Reaction } from "../game/chat";

/** The full picker, fetched the first time a tray's "+" is pressed. */
const ChatEmojiPicker = lazy(() => import("./ChatEmojiPicker"));

/**
 * The reactions on one line, each a chip with its count. Pressing a chip adds
 * the player's own reaction of that emoji, or takes it back if it is theirs
 * already; the player's own chips are drawn pressed.
 */
export function ReactionChips({
  reactions,
  ownHandle,
  disabled,
  onToggle,
}: {
  reactions: readonly Reaction[];
  ownHandle: string | null;
  disabled: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <span className="chat__reactions">
      {reactions.map(({ emoji, handles }) => {
        const mine = ownHandle !== null && handles.includes(ownHandle);
        const who = reactorsLabel(handles, ownHandle);
        return (
          <button
            key={emoji}
            type="button"
            className={`chat__reaction${mine ? " chat__reaction--mine" : ""}`}
            aria-pressed={mine}
            aria-label={`${emoji} ${handles.length}, from ${who}`}
            title={`${who} reacted ${emoji}`}
            disabled={disabled}
            onClick={() => onToggle(emoji)}
          >
            <span className="chat__reaction-emoji" aria-hidden="true">
              {emoji}
            </span>
            <span className="chat__reaction-count" aria-hidden="true">
              {handles.length}
            </span>
          </button>
        );
      })}
    </span>
  );
}

/**
 * The quick reactions for one line, opened by its react button or by holding
 * it, with a "+" at the end for the full picker.
 */
export function ReactionTray({
  onPick,
  onMore,
}: {
  onPick: (emoji: string) => void;
  onMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tray = ref.current;
    tray?.scrollIntoView?.({ block: "nearest" });
    tray?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="chat__tray" role="group" aria-label="React" ref={ref}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="chat__tray-emoji"
          aria-label={`React ${emoji}`}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button type="button" className="chat__tray-more" aria-label="More reactions" onClick={onMore}>
        +
      </button>
    </div>
  );
}

/**
 * The full picker over the bottom of the panel, for a reaction the tray does
 * not offer.
 */
export function ReactionPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="chat__picker" role="dialog" aria-label="Pick a reaction">
      <div className="chat__picker-bar">
        <span>Pick a reaction</span>
        <button type="button" className="chat__close" aria-label="Close reactions" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="chat__picker-body">
        <Suspense fallback={<p className="chat__empty">Loading…</p>}>
          <ChatEmojiPicker onPick={onPick} />
        </Suspense>
      </div>
    </div>
  );
}

/** The add-reaction button on a line: a smiley with a plus. */
export function ReactButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="chat__react"
      aria-label="Add reaction"
      aria-expanded={open}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M20 12a8 8 0 1 1-8-8" />
        <path d="M8.5 14.5a4 4 0 0 0 7 0" />
        <path d="M9 10h.01M15 10h.01" strokeWidth="2.5" />
        <path d="M19 2v6M16 5h6" />
      </svg>
    </button>
  );
}
