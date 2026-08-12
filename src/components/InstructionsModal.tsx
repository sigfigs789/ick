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
          <li>WordInk gives everyone the same daily drop—say, “INK”. Find the rarest English word you can that contains it, like th<strong>INK</strong>, wr<strong>INK</strong>le, or <strong>INK</strong>ling.</li>
          <li>A Rare-or-better word immediately keeps your streak going. After your first valid word, you can lock in or keep guessing up to 6 times.</li>
        </ol>
        <p className="modal__rarity-note">
          Rarity scores reflect how often words appear across sources including books, news, movies,
          websites, social media, and more. They do not reflect how complex a word is. The highest rank is
          Mythic, at 9.5+ rarity.
        </p>
      </div>
    </div>
  );
}
