import { useState } from "react";

interface Props {
  text: string;
}

export function ShareButton({ text }: Props) {
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
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className="share-button"
      onClick={handleClick}
      aria-live="polite"
    >
      {copied ? "Copied!" : "Share result"}
    </button>
  );
}
