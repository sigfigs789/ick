import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";

interface Props {
  /** The DOM node to rasterize -- should contain the shareable content only (no buttons/toggles). */
  targetRef: RefObject<HTMLElement | null>;
  /** When true, word text inside the capture is blurred (rarity badges stay legible) before rasterizing. */
  spoilerFree: boolean;
  fileName?: string;
}

type Status = "idle" | "working" | "copied" | "error";

const LABELS: Record<Status, string> = {
  idle: "📸 Share image",
  working: "Generating…",
  copied: "Image copied!",
  error: "Couldn't create image",
};

/**
 * Captures `targetRef` as a PNG and copies it straight to the clipboard --
 * no share-sheet/dialog in between, so a paste into Messages, Discord,
 * etc. is a single click-then-paste. Falls back to a plain file download
 * only if the Clipboard API's image write isn't available at all.
 */
export function ShareImageButton({ targetRef, spoilerFree, fileName = "drop-result.png" }: Props) {
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

    // `node` itself has no horizontal padding -- on screen it visually
    // gets some from the surrounding card, but that card isn't part of
    // the capture, so without this the exported image runs edge-to-edge.
    // Added/removed around the capture only, so the on-screen layout
    // (which already looks right) doesn't shift.
    node.classList.add("results-panel__capture--exporting");

    try {
      await document.fonts?.ready;
      const backgroundColor = getComputedStyle(node).backgroundColor;
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor });
      if (!blob) throw new Error("toBlob returned null");

      if (navigator.clipboard && "write" in navigator.clipboard) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus("copied");
    } catch {
      setStatus("error");
    } finally {
      wordEls?.forEach((el) => el.classList.remove("spoiler-blur"));
      node.classList.remove("results-panel__capture--exporting");
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
