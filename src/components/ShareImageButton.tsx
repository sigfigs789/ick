import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";

interface Props {
  /** The DOM node to rasterize -- should contain the shareable content only (no buttons/toggles). */
  targetRef: RefObject<HTMLElement | null>;
  /** When true, word text inside the capture is blurred (rarity badges stay legible) before rasterizing. */
  spoilerFree: boolean;
  fileName?: string;
}

type Status = "idle" | "working" | "shared" | "copied" | "error";

const LABELS: Record<Status, string> = {
  idle: "📸 Share image",
  working: "Generating…",
  shared: "Shared!",
  copied: "Image copied!",
  error: "Couldn't create image",
};

/**
 * Captures `targetRef` as a PNG and hands it off via, in order of
 * preference: the native share sheet (best on mobile), the clipboard (best
 * on desktop), or a plain file download (universal last resort).
 */
export function ShareImageButton({ targetRef, spoilerFree, fileName = "ink-result.png" }: Props) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    const node = targetRef.current;
    if (!node || status === "working") return;
    setStatus("working");

    // Blur just the word text for the duration of the capture -- the
    // rarity badges (a sibling element, untouched) stay fully legible.
    const wordEls = spoilerFree
      ? node.querySelectorAll<HTMLElement>(
          ".results-panel__word, .results-panel__best-word span"
        )
      : null;
    wordEls?.forEach((el) => el.classList.add("spoiler-blur"));

    try {
      await document.fonts?.ready;
      const backgroundColor = getComputedStyle(node).backgroundColor;
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor });
      if (!blob) throw new Error("toBlob returned null");

      const file = new File([blob], fileName, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Ink result" });
        setStatus("shared");
      } else if (navigator.clipboard && "write" in navigator.clipboard) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setStatus("copied");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("copied");
      }
    } catch (err) {
      // A user cancelling the native share sheet also lands here (AbortError)
      // -- that's not really a failure, so don't show an error state for it.
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      setStatus(cancelled ? "idle" : "error");
    } finally {
      wordEls?.forEach((el) => el.classList.remove("spoiler-blur"));
      window.setTimeout(() => setStatus("idle"), 2200);
    }
  }

  return (
    <button
      type="button"
      className="share-button share-button--image"
      onClick={handleClick}
      disabled={status === "working"}
      aria-live="polite"
    >
      {LABELS[status]}
    </button>
  );
}
