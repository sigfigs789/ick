import { useEffect, useId, useRef, useState } from "react";
import {
  atRisk,
  freezeRules,
  freezesOn,
  resting,
  savedFreezeCovering,
  wasFrozen,
  weekdayRestProgress,
} from "../game/streakFreeze";
import type { StreakState } from "../game/types";
import { RestDayBadge } from "./RestDayBadge";
import { DoOverBadge } from "./DoOverBadge";
import { doOverProgress } from "../game/doOver";
import { useKeepInViewport } from "../hooks/useKeepInViewport";

function freezeSummary(banked: number, cap: number): string {
  if (banked === 0) return "No 🧊 acquired";
  // Held from when the limit was three; kept, but no more are earned past it.
  if (banked > cap) return `${banked} 🧊 acquired, over the limit of ${cap}`;
  return `${banked} of ${cap} 🧊 acquired`;
}

/**
 * The 🧊 saved/max badge. Selecting it opens a popup with the count and the
 * rules; selecting it again, anywhere outside it, or Escape closes it.
 */
function FreezeBadge({ banked, cap, currentStreak }: { banked: number; cap: number; currentStreak: number }) {
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
    <span className="streak-display__freeze-wrap" ref={wrapRef}>
      <button
        type="button"
        className="streak-display__freezes"
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={`Streak freezes: ${banked} of ${cap}`}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">🧊</span>
        <span className="streak-display__count">
          {banked}/{cap}
        </span>
      </button>
      {open && (
        <span className="streak-display__freeze-popup" id={popupId} role="dialog" aria-label="Streak freezes">
          <strong>{freezeSummary(banked, cap)}</strong>
          <span>{freezeRules(currentStreak, cap)}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The streak icon and count, with no "day streak" beside them: selecting (or
 * hovering) them opens a popup that says so, and what the ⏳ or 🧊 means.
 */
function StreakBadge({ icon, count, note }: { icon: string | null; count: number; note?: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLSpanElement>(null);
  const popupId = useId();
  const label = `${count} day streak`;
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
      className="rest-day streak-display__streak"
      ref={wrapRef}
      // Mouse only: a tap also fires pointerenter, and the click handles taps.
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        className="rest-day__button streak-display__streak-button"
        aria-expanded={open || hovered}
        aria-controls={popupId}
        aria-label={note ? `${label}. ${note}` : label}
        onClick={() => setOpen((was) => !was)}
      >
        {icon && (
          <span className="streak-display__flame" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="streak-display__count">{count}</span>
      </button>
      {(open || hovered) && (
        <span className="rest-day__popup" id={popupId} ref={popupRef} role="dialog" aria-label="Streak">
          <strong>{label}</strong>
          {note && <span>{note}</span>}
        </span>
      )}
    </span>
  );
}

interface Props {
  streak: StreakState;
  totalRarity?: number;
  /** Puzzle date, which decides whether today's freeze state is shown. */
  date?: string;
  /** Whether `date` is today's puzzle, which is when a freeze spent yesterday is news. */
  isToday?: boolean;
  /**
   * The play screen (see App.tsx): leave out what would only be
   * zeros -- the freeze badge until the player can hold a freeze, the total until a word
   * is banked, and the whole strip for a player with neither a streak, a
   * freeze cap, nor a word yet.
   */
  hideEmpty?: boolean;
  /** Whether this puzzle has a banked word, for `hideEmpty`. */
  hasWords?: boolean;
}

export function StreakDisplay({
  streak,
  totalRarity = 0,
  date,
  isToday = false,
  hideEmpty = false,
  hasWords = true,
}: Props) {
  // One icon for how the streak stands, as the streak board marks it (see
  // components/LeaderboardPage.tsx): 😴 on an earned weekend day not
  // played yet, which cannot end the streak; ⏳ when missing today ends the streak,
  // every saved freeze spent; 🧊 while a saved freeze is covering a missed day
  // with one left for today, until today is played; 🔥 otherwise. A past
  // puzzle whose day a freeze covered shows 🧊 too: that day the streak was
  // kept by a freeze, not by play.
  const restDay = isToday && date !== undefined && resting(streak, date);
  const frozen = !restDay && isToday && date !== undefined && savedFreezeCovering(streak, date);
  const risky = !restDay && isToday && date !== undefined && atRisk(streak, date);
  const coveredDay = !isToday && date !== undefined && wasFrozen(streak, date);
  const icon = risky ? "⏳" : frozen || coveredDay ? "🧊" : streak.currentStreak >= 2 ? "🔥" : null;
  const streakNote = coveredDay
    ? "A freeze kept your streak alive on this day"
    : risky
      ? frozen
        ? "A saved freeze is covering your streak, and none is left: play today to keep it"
        : "You missed yesterday: play today to keep your streak"
      : frozen
        ? "A saved freeze is covering your streak"
        : undefined;
  // The days played towards the next lazy weekend (a pie, or
  // 😴 once unlocked), beside the freezes. Only for a live streak, which is
  // what a lazy weekend keeps.
  const week =
    isToday && date !== undefined && streak.currentStreak > 0 ? weekdayRestProgress(streak, date) : null;
  // The days played towards this week's do-over (see game/doOver.ts), once one is.
  const doOverWeek = isToday && date !== undefined ? doOverProgress(streak, date) : null;
  const showDoOver = doOverWeek !== null && (doOverWeek.played > 0 || doOverWeek.spent);
  // A past puzzle shows the freezes held on its day; today's shows today's.
  const { banked, cap } = freezesOn(streak, isToday ? undefined : date);
  // Hidden only before the player can hold a freeze at all. The cap is set by
  // the longest streak ever, so a player whose streak has ended still has one
  // to show, and the row stays for it.
  const showFreezes = !hideEmpty || cap > 0;
  const showTotal = !hideEmpty || hasWords;
  const showStreak = !hideEmpty || streak.currentStreak > 0 || frozen || risky || cap > 0;
  if (!showStreak && !showTotal) return null;
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        (restDay ? "Lazy weekend: skipping today can't break your streak. " : "") +
        (coveredDay ? "A freeze kept your streak alive on this day. " : "") +
        (frozen ? "A saved freeze is covering your streak. " : "") +
        (risky ? "Play today to keep your streak. " : "") +
        `Streak freezes: ${banked} of ${cap}. ` +
        `This puzzle's total score: ${totalRarity.toFixed(1)}.`
      }
    >
      {showStreak && (
        <div className="streak-display__row">
          {restDay && <RestDayBadge className="streak-display__flame" />}
          <StreakBadge icon={restDay ? null : icon} count={streak.currentStreak} note={streakNote} />
          {showFreezes && <FreezeBadge banked={banked} cap={cap} currentStreak={streak.currentStreak} />}
          {week && (
            <RestDayBadge
              played={week.played}
              reachable={week.reachable}
              sundayOnly={week.sundayOnly}
              className="streak-display__week"
            />
          )}
          {showDoOver && (
            <DoOverBadge played={doOverWeek.played} reachable={doOverWeek.reachable} spent={doOverWeek.spent} />
          )}
        </div>
      )}
      {showTotal && (
        <div className="streak-display__rarity-scores">
          <span className="streak-display__rarity-score">
            <span>Total</span>
            <strong>{totalRarity.toFixed(1)}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
