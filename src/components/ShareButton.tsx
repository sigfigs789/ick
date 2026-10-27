import { useState } from "react";
import { copyText } from "../clipboard";
import type { FlameTier } from "../game/shareFlamesTest";
import { ShareFlames } from "./ShareFlames";

interface Props {
  text: string;
  /** Called after the result has been copied to the player's clipboard. */
  onShared?: () => void;
  /** The tier the button burns in, or none (see game/shareFlamesTest.ts). */
  flames?: FlameTier | null;
}

export function ShareButton({ text, onShared, flames = null }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    await copyText(text);
    setCopied(true);
    onShared?.();
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className={`share-button${flames ? " share-flames-host" : ""}`}
      onClick={handleClick}
      aria-live="polite"
    >
      {flames && <ShareFlames tier={flames} />}
      {copied ? "Copied!" : "Share"}
      {!copied && (
        <svg
          className="share-button__copy-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  );
}
