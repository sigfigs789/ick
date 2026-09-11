import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  /** Spend the retry and show the word. */
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The confirmation behind "Word of the day": seeing it costs the puzzle's
 * unspent retry (see storage.forfeitRetry).
 *
 * A modal rather than an inline "are you sure": the cost is not obvious from
 * the button -- a player who has not used the retry yet may not even know they
 * are holding one -- and it cannot be undone once paid.
 */
export function RevealWordModal({ open, onConfirm, onClose }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on "Never mind", not on the button that spends the retry: the
  // safe half of a one-way choice is the one a stray Return should hit.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-word-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="reveal-word-heading">See the word of the day?</h2>
        </div>
        <p className="modal__copy">
          It's a good one — but it costs your retry, so you won't be able to
          take a word back on this puzzle afterwards.
        </p>
        <div className="reveal-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="reveal-modal__cancel"
            onClick={onClose}
          >
            Never mind
          </button>
          <button
            type="button"
            className="reveal-modal__confirm"
            onClick={onConfirm}
          >
            Show me
          </button>
        </div>
      </div>
    </div>
  );
}
