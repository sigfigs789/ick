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
          <h2 id="instructions-heading">How to play Ick</h2>
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
          <li>Everyone gets the same letter fragment each day, like STR or OU.</li>
          <li>Find three different valid English words that contain those letters together, in that order.</li>
          <li>Submitting an invalid word just gives you feedback — no penalty, no timer.</li>
          <li>Each accepted word reveals a rarity label, from Very Common to Extremely Rare — just a fun bonus, not a score.</li>
          <li>Finish all three to complete the day and keep your streak going.</li>
        </ol>
      </div>
    </div>
  );
}
