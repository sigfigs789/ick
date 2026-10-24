import { useEffect, useId, useRef, useState } from "react";

/** What the dancer means, for its hover text and popup. */
const REST_DAY_RULE = "Saturdays don't break streaks. Skip today and your streak is safe.";

/** The Saturday faces, one per player. */
const REST_DAY_ICONS = ["🕺", "💃", "😴"] as const;

/**
 * 🕺, 💃 or 😴 for a player, the same one every Saturday: chosen from the
 * player id, so the board shows a mix and a player always sees their own.
 */
function restDayDancer(playerId: string): (typeof REST_DAY_ICONS)[number] {
  let sum = 0;
  for (const char of playerId) sum += char.charCodeAt(0);
  return REST_DAY_ICONS[sum % REST_DAY_ICONS.length];
}

/**
 * The dancer shown on a streak taking its Saturday off (see `resting` in
 * game/streakFreeze.ts). Hovering it shows the rule; selecting it opens a popup
 * with the rule, and selecting it again, anywhere outside it, or Escape closes
 * it.
 */
export function RestDayBadge({ playerId, className }: { playerId: string; className?: string }) {
  const [open, setOpen] = useState(false);
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
    <span className={`rest-day${className ? ` ${className}` : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="rest-day__button"
        title={REST_DAY_RULE}
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={`Saturday rest day: ${REST_DAY_RULE}`}
        onClick={() => setOpen((was) => !was)}
      >
        {restDayDancer(playerId)}
      </button>
      {open && (
        <span className="rest-day__popup" id={popupId} role="dialog" aria-label="Saturday rest day">
          <strong>Saturday rest day</strong>
          <span>{REST_DAY_RULE}</span>
        </span>
      )}
    </span>
  );
}
