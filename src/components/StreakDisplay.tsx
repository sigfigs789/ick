import { useEffect, useId, useRef, useState } from "react";
import {
  atRisk,
  freezeProgress,
  freezesOn,
  freezeTip,
  isRestDay,
  REST_DAY_PLAYS,
  resting,
  savedFreezeCovering,
  wasFrozen,
  weekdayRestProgress,
} from "../game/streakFreeze";
import type { StreakState } from "../game/types";
import { RestDayBadge, WeekPie } from "./RestDayBadge";
import { DoOverBadge } from "./DoOverBadge";
import { doOverProgress } from "../game/doOver";
import { dayOfWeek } from "../game/date";
import { useKeepInViewport } from "../hooks/useKeepInViewport";

function freezeSummary(banked: number, cap: number, earning?: { played: number; of: number }): string {
  if (banked === 0) {
    return earning ? `No 🧊 acquired: ${earning.played} of ${earning.of} days to the next` : "No 🧊 acquired";
  }
  // Held from when the limit was three; kept, but no more are earned past it.
  if (banked > cap) return `${banked} 🧊 acquired, over the limit of ${cap}`;
  return `${banked} of ${cap} 🧊 acquired`;
}

/**
 * The 🧊 saved/max badge. With none saved, given `earning`, a pie of the days
 * played towards the next stands in for the 🧊, as the do-over's does (see
 * DoOverBadge.tsx), and the 🧊 comes back once one is earned. Selecting it
 * opens a popup with the count and the rules; selecting it again, anywhere
 * outside it, or Escape closes it.
 */
function FreezeBadge({
  banked,
  cap,
  earning,
}: {
  banked: number;
  cap: number;
  earning?: { played: number; of: number };
}) {
  const pie = banked === 0 ? earning : undefined;
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
        {pie ? <WeekPie played={pie.played} of={pie.of} /> : <span aria-hidden="true">🧊</span>}
        {/* Before any can be held, the pie alone: 0/0 says nothing. */}
        {(cap > 0 || banked > 0) && (
          <span className="streak-display__count">
            {banked}/{cap}
          </span>
        )}
      </button>
      {open && (
        <span className="streak-display__freeze-popup" id={popupId} role="dialog" aria-label="Streak freezes">
          <strong>{freezeSummary(banked, cap, pie)}</strong>
          <span>{freezeTip(cap)}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The streak icon and count, with no "day streak" beside them: selecting (or
 * hovering) them opens a popup that says so.
 */
function StreakBadge({ icon, count }: { icon: string | null; count: number }) {
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
        aria-label={label}
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
  // The days played towards the next lazy weekend (a pie, or
  // 😴 once unlocked), beside the freezes. Only for a live streak, which is
  // what a lazy weekend keeps.
  // An earned weekend day already played keeps its 😴 until Monday starts the
  // next week's count, rather than an empty pie that reads as play not counted.
  const weekendEarned =
    !restDay && isToday && date !== undefined && streak.currentStreak > 0 && isRestDay(streak, date);
  const week =
    isToday && date !== undefined && streak.currentStreak > 0 ? weekdayRestProgress(streak, date) : null;
  // The days played towards the do-over (see game/doOver.ts), once one is, or it is held.
  const doOverWeek = isToday && date !== undefined ? doOverProgress(streak, date) : null;
  const showDoOver = doOverWeek !== null && doOverWeek.played > 0;
  // A past puzzle shows the freezes held on its day; today's shows today's.
  const { banked, cap } = freezesOn(streak, isToday ? undefined : date);
  // Shown once there is a streak, so its pie fills towards the first freeze
  // even before one can be held, or once the player can hold one. The cap is
  // set by the longest streak ever, so a player whose streak has ended still
  // has one to show, and the row stays for it.
  const showFreezes = !hideEmpty || cap > 0 || streak.currentStreak > 0;
  // The days towards the next freeze, for its pie: only for the streak as it
  // stands now, not a past puzzle's.
  const freezeEarning = isToday || date === undefined ? freezeProgress(streak) : undefined;
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
          <StreakBadge icon={restDay ? null : icon} count={streak.currentStreak} />
          {showFreezes && (
            <FreezeBadge banked={banked} cap={cap} earning={freezeEarning} />
          )}
          {weekendEarned && (
            <RestDayBadge played={REST_DAY_PLAYS} sundayOnly={dayOfWeek(date) === 6} className="streak-display__week" />
          )}
          {week && (
            <RestDayBadge
              played={week.played}
              reachable={week.reachable}
              sundayOnly={week.sundayOnly}
              className="streak-display__week"
            />
          )}
          {showDoOver && (
            <DoOverBadge played={doOverWeek.played} />
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
