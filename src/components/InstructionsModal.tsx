import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InstructionsModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
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
        aria-labelledby="instructions-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="instructions-heading">How to play Ink</h2>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close instructions"
          >
            ×
          </button>
        </div>
        <ol className="modal__steps">
          <li>Every day everyone gets splashed with the same letter fragment — say, INK. Your job is to dip into your vocabulary and pull out words stained with it, like dr<strong>INK</strong>, th<strong>INK</strong>, or p<strong>INK</strong>.</li>
          <li>Enter valid English words that contain those letters together, in that order — you get up to 6 distinct words.</li>
          <li>Blot the page all you want: submitting an invalid word just gives you feedback — no penalty, no timer, and it doesn't use up a guess.</li>
          <li>Each accepted word reveals a rarity, from Very Common to Extremely Rare. The goal is finding the rarest word you can — your inkiest gem gets crowned 👑 in the log.</li>
          <li>Stop anytime with "Lock in my result," or use all 6 guesses — either way completes the day and keeps your streak going.</li>
          <li>Click any word already in your log to load it back into the box if you want to try a variation.</li>
        </ol>
      </div>
    </div>
  );
}
