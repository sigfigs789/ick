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
          <h2 id="instructions-heading">How to play WordInk</h2>
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
          <li>WordInk gives everyone the same daily ink — say, “INK”. Your job is to dip into your vocabulary and pull out words stained with it, like dr<strong>INK</strong>, th<strong>INK</strong>, or p<strong>INK</strong>.</li>
          <li>After your first valid word, lock in or keep guessing up to 6 times. A Rare-or-better result keeps your streak going.</li>
        </ol>
      </div>
    </div>
  );
}
