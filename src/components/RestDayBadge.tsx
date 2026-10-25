import { useEffect, useId, useRef, useState } from "react";
import { REST_DAY_PLAYS } from "../game/streakFreeze";

/** What the 😴 means on a day of the weekend itself, for its hover text and popup. */
const REST_DAY_RULE = "3 days played, so the weekend's all yours: skipping today can't break the streak.";

/**
 * What the badge means before the weekend is taken, with `played` of the
 * week's days played; `sundayOnly` when three would now earn only Sunday.
 */
function weekdayRule(played: number, reachable: boolean, sundayOnly: boolean): string {
  if (played >= REST_DAY_PLAYS) {
    return sundayOnly
      ? "Unlocked: Sunday's for snoozing, skipping it can't break your streak."
      : "Unlocked: kick back all weekend, skipping Saturday and Sunday can't break your streak.";
  }
  if (!reachable) {
    return "Play any 3 days by Friday for a lazy weekend 😴, or by Saturday for a lazy Sunday: skipping them can't break your streak.";
  }
  return sundayOnly
    ? `Play 3 days by Saturday and snooze through Sunday: skipping it can't break your streak. ${played} of 3 so far.`
    : `Play any 3 days this week and your streak is paused through the weekend. ${played} of 3 days played so far.`;
}

/** A pie a third full for each day played, drawn in the text colour. */
function WeekPie({ played }: { played: number }) {
  const r = 7;
  const angle = (played / REST_DAY_PLAYS) * 2 * Math.PI;
  const x = 8 + r * Math.sin(angle);
  const y = 8 - r * Math.cos(angle);
  return (
    <svg className="rest-day__pie" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {played > 0 && (
        <path
          d={`M8 8 L8 ${8 - r} A${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`}
          fill="currentColor"
        />
      )}
    </svg>
  );
}

/**
 * The lazy weekend badge. On the weekend itself (no `played`), the 😴 shown
 * on a streak taking a day of the weekend off its week's play earned (see `resting`
 * in game/streakFreeze.ts). Before it, given the week's days `played`, a
 * pie filling a third a day that turns 😴 on the third (see `isRestDay`).
 * Hovering it with a mouse opens a popup with the rule while the pointer stays
 * on it; selecting it pins the popup open, and selecting it again, anywhere
 * outside it, or Escape closes it.
 */
export function RestDayBadge({
  className,
  played,
  reachable = true,
  sundayOnly = false,
}: {
  className?: string;
  played?: number;
  /** Whether three days can still be played this week; the rule then speaks of next week. */
  reachable?: boolean;
  /** Whether three days would now earn only Sunday, Friday being past or out of reach. */
  sundayOnly?: boolean;
}) {
  const rule = played === undefined ? REST_DAY_RULE : weekdayRule(played, reachable, sundayOnly);
  const unlocked = played === undefined || played >= REST_DAY_PLAYS;
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
        aria-label={`Lazy weekend: ${rule}`}
        onClick={() => setOpen((was) => !was)}
      >
        {unlocked ? "😴" : <WeekPie played={played} />}
      </button>
      {(open || hovered) && (
        <span className="rest-day__popup" id={popupId} role="dialog" aria-label="Lazy weekend">
          <strong>Lazy weekend</strong>
          <span>{rule}</span>
        </span>
      )}
    </span>
  );
}
