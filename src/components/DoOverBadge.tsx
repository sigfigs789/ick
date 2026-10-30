import { useEffect, useId, useRef, useState } from "react";
import { DO_OVER_EMOJI, DO_OVER_PLAYS } from "../game/doOver";
import { WeekPie } from "./RestDayBadge";

/** What the badge says, with `played` of the week's days played. */
function doOverRule(played: number, reachable: boolean, spent: boolean): string {
  if (spent) return `Used this week. Play ${DO_OVER_PLAYS} days next week for another.`;
  if (played >= DO_OVER_PLAYS) return `Unlocked: an extra retry ${DO_OVER_EMOJI} this week.`;
  if (!reachable) return `Play ${DO_OVER_PLAYS} days in a week to unlock a do-over ${DO_OVER_EMOJI}.`;
  return `Play ${DO_OVER_PLAYS} days this week to unlock a do-over ${DO_OVER_EMOJI}. ${played} of ${DO_OVER_PLAYS} so far.`;
}

/**
 * The do-over badge, beside the lazy weekend's (see game/doOver.ts): a pie
 * filling a quarter a day played this week that turns 🔄 on the fourth, and
 * stays, faded, once spent. Hover or select it for the rule, as the lazy
 * weekend's pie does.
 */
export function DoOverBadge({
  played,
  reachable,
  spent,
}: {
  played: number;
  /** Whether DO_OVER_PLAYS can still be played this week. */
  reachable: boolean;
  spent: boolean;
}) {
  const rule = doOverRule(played, reachable, spent);
  const unlocked = spent || played >= DO_OVER_PLAYS;
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
      className={`rest-day streak-display__week do-over${spent ? " do-over--spent" : ""}`}
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
        <span className="rest-day__popup" id={popupId} role="dialog" aria-label="Do-over">
          <strong>Do-over</strong>
          <span>{rule}</span>
        </span>
      )}
    </span>
  );
}
