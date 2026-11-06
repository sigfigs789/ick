import { useEffect, useId, useRef, useState } from "react";
import { DO_OVER_EMOJI, DO_OVER_PLAYS } from "../game/doOver";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { WeekPie } from "./RestDayBadge";

/** What the badge says, with `played` of the days played towards the next do-over. */
function doOverRule(played: number): string {
  if (played >= DO_OVER_PLAYS)
    return `Ready: an extra retry ${DO_OVER_EMOJI}, kept until you use it. You can hold one at a time.`;
  return `Play ${DO_OVER_PLAYS} days to earn a do-over ${DO_OVER_EMOJI}, an extra retry. ${played} of ${DO_OVER_PLAYS} so far.`;
}

/**
 * The do-over badge, beside the lazy weekend's (see game/doOver.ts): a pie
 * filling a fifth a day played that turns 🔄 on the fifth, and starts
 * over once it is spent. Hover or select it for the rule, as the lazy
 * weekend's pie does.
 */
export function DoOverBadge({
  played,
}: {
  played: number;
}) {
  const rule = doOverRule(played);
  const unlocked = played >= DO_OVER_PLAYS;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLSpanElement>(null);
  const popupId = useId();
  useKeepInViewport(popupRef, open || hovered);

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
      className="rest-day streak-display__week do-over"
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
        aria-label={`Do-over: ${rule}`}
        onClick={() => setOpen((was) => !was)}
      >
        {unlocked ? DO_OVER_EMOJI : <WeekPie played={played} of={DO_OVER_PLAYS} />}
      </button>
      {(open || hovered) && (
        <span className="rest-day__popup" id={popupId} ref={popupRef} role="dialog" aria-label="Do-over">
          <strong>Do-over</strong>
          <span>{rule}</span>
        </span>
      )}
    </span>
  );
}
