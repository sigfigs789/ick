import { useEffect, useId, useRef, useState } from "react";

/** What the 😴 means, for its hover text and popup. */
const REST_DAY_RULE =
  "3 days played this week unlocked a lazy Saturday: skipping it can't break the streak. " +
  "Today only, so kick back or play and get ahead.";

/**
 * The 😴 shown on a streak taking the Saturday off its week's play earned
 * (see `resting` in game/streakFreeze.ts). Hovering it with a mouse opens a
 * popup with the rule while the pointer stays on it; selecting it pins the
 * popup open, and selecting it again, anywhere outside it, or Escape closes it.
 */
export function RestDayBadge({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span
      className={`rest-day${className ? ` ${className}` : ""}`}
      ref={wrapRef}
      // Mouse only: a tap also fires pointerenter, and the click handles taps.
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        className="rest-day__button"
        aria-expanded={open || hovered}
        aria-controls={popupId}
        aria-label={`Lazy Saturday: ${REST_DAY_RULE}`}
        onClick={() => setOpen((was) => !was)}
      >
        😴
      </button>
      {(open || hovered) && (
        <span className="rest-day__popup" id={popupId} role="dialog" aria-label="Lazy Saturday">
          <strong>Lazy Saturday</strong>
          <span>{REST_DAY_RULE}</span>
        </span>
      )}
    </span>
  );
}
