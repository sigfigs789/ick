import { useState, type MouseEvent } from "react";
import { toBlob } from "html-to-image";
import { shareImage } from "./shareImage";

type Status = "idle" | "working" | "copied" | "shared" | "error";

const LABELS: Record<Status, string> = {
  idle: "Share",
  working: "Making image…",
  copied: "Image copied!",
  shared: "Shared!",
  error: "Couldn't share",
};

/** The floating card a share button sits in: every header celebration's wrapper. */
const CARD_SELECTOR = ".improvement, .perfect-month";

/**
 * The card as a still: a copy of what is on screen, finished rather than mid
 * animation, without its controls (anything marked `data-share-omit`) and
 * signed WordInk. A copy rather than the card itself, so the one on screen
 * never flickers, and set down off-screen in its own wrapper's classes, so it
 * keeps its colours. The wrapper is what is captured: the host's off-screen
 * position would be copied into the image along with it.
 */
async function snapshot(card: HTMLElement): Promise<Blob | null> {
  const host = document.createElement("div");
  host.className = "celebration-share-host";
  const copy = card.cloneNode(true) as HTMLElement;
  copy.removeAttribute("role");
  copy.querySelectorAll("[data-share-omit]").forEach((node) => node.remove());
  const brand = document.createElement("span");
  brand.className = "celebration-share-host__brand";
  brand.textContent = "WordInk";
  (copy.firstElementChild ?? copy).appendChild(brand);
  host.appendChild(copy);
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    return await toBlob(copy, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
    });
  } finally {
    host.remove();
  }
}

/**
 * Share a header celebration as an image: the share sheet if the device has
 * one, else the clipboard, else a download. It snapshots the card it sits in,
 * so every card shares the same way without saying what it shows.
 */
export function CelebrationShareButton({ name }: { name: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (status === "working") return;
    const card = event.currentTarget.closest<HTMLElement>(CARD_SELECTOR);
    if (!card) return;
    setStatus("working");
    try {
      const blob = await snapshot(card);
      if (!blob) throw new Error("toBlob returned null");
      const result = await shareImage(blob, `wordink-${name}.png`, "WordInk");
      setStatus(result === "cancelled" ? "idle" : result);
    } catch {
      setStatus("error");
    } finally {
      window.setTimeout(() => setStatus("idle"), 2200);
    }
  }

  return (
    <button
      type="button"
      className="celebration-share"
      onClick={handleClick}
      disabled={status === "working"}
      aria-live="polite"
      aria-label="Share this as an image"
      data-share-omit
    >
      {LABELS[status]}
    </button>
  );
}
