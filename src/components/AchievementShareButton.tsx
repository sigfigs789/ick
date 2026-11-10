import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { toBlob } from "html-to-image";
import type { EarnedAchievement } from "../game/achievements";

type Status = "idle" | "working" | "copied" | "shared" | "error";

const LABELS: Record<Status, string> = {
  idle: "Share",
  working: "Making image…",
  copied: "Image copied!",
  shared: "Shared!",
  error: "Couldn't share",
};

/**
 * The celebration card (see AchievementCelebration) as a still: the badge on
 * its rays, the title, what it took, and the word that earned it. It names
 * WordInk but carries no link.
 */
export function AchievementShareCard({ achievement }: { achievement: EarnedAchievement }) {
  return (
    <div className="achievement-share-card">
      <span className="achievement-unlocked__eyebrow">Achievement unlocked</span>
      <span className="achievement-unlocked__medal">
        <span className="achievement-unlocked__rays" />
        <span className="achievement-unlocked__badge">{achievement.icon}</span>
      </span>
      <span className="improvement__title">{achievement.title}</span>
      <span className="improvement__body">{achievement.description}</span>
      {achievement.word && (
        <span className="achievement-unlocked__word">
          With <strong>{achievement.word}</strong>
        </span>
      )}
      <span className="achievement-share-card__brand">WordInk</span>
    </div>
  );
}

/** Renders the card off-screen, rasterizes it, and tidies up. */
async function renderCardBlob(achievement: EarnedAchievement): Promise<Blob | null> {
  const host = document.createElement("div");
  host.className = "achievement-share-host";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<AchievementShareCard achievement={achievement} />));
    await document.fonts?.ready;
    const node = host.firstElementChild as HTMLElement;
    return await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(node).backgroundColor,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Shares an earned achievement as an image: the share sheet if the device has one, else the clipboard, else a download. */
export function AchievementShareButton({ achievement }: { achievement: EarnedAchievement }) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleClick() {
    if (status === "working") return;
    setStatus("working");
    try {
      const blob = await renderCardBlob(achievement);
      if (!blob) throw new Error("toBlob returned null");
      const fileName = `wordink-${achievement.id}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: achievement.title });
          setStatus("shared");
        } catch (error) {
          // Closing the share sheet isn't a failure.
          setStatus(error instanceof DOMException && error.name === "AbortError" ? "idle" : "error");
        }
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
        setStatus("shared");
      }
    } catch {
      setStatus("error");
    } finally {
      window.setTimeout(() => setStatus("idle"), 2200);
    }
  }

  return (
    <button
      type="button"
      className="stats__achievement-share-button"
      onClick={handleClick}
      disabled={status === "working"}
      aria-live="polite"
      aria-label={`Share the ${achievement.title} achievement as an image`}
    >
      {LABELS[status]}
    </button>
  );
}
