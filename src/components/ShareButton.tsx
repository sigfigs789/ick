import { useState } from "react";

interface Props {
  text: string;
  /** Called after the result has been copied to the player's clipboard. */
  onShared?: () => void;
}

export function ShareButton({ text, onShared }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can fail (permissions, insecure context, older
      // browsers) -- fall back to a manual copy via a temporary textarea.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    onShared?.();
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className="share-button"
      onClick={handleClick}
      aria-live="polite"
    >
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
