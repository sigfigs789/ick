import { useEffect, useId, useRef, useState } from "react";
import { addDays } from "../game/date";
import {
  atRisk,
  catchUpDays,
  freezesOn,
  resting,
  savedFreezeCovering,
  wasFrozen,
  weekdayRestProgress,
} from "../game/streakFreeze";
import type { StreakState } from "../game/types";
import { RestDayBadge } from "./RestDayBadge";

/** How saved freezes work, for the freeze badge's popup. */
const FREEZE_RULES =
  "🧊 saves your streak on a missed day. Earn one on day 3, then every 7 days. " +
  "Hold 1, or 2 after a 14 day streak.";

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
function FreezeBadge({ banked, cap }: { banked: number; cap: number }) {
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
          <span>{FREEZE_RULES}</span>
        </span>
      )}
    </span>
  );
}

/** A missed day's puzzle as the catch-up popup names it: yesterday's, or by date. */
function dayLabel(date: string, today: string): string {
  if (date === addDays(today, -1)) return "yesterday's";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}'s`;
}

/**
 * Over the streak count while it is ⚠️ (see `catchUpDays` in
 * game/streakFreeze.ts): the freezes are spent, and the streak lives only if
 * the missed puzzle is played before today's. Shown without being asked
 * for, because this is the one day the streak can be saved and nothing else
 * on the screen says how; closed with ×, for this visit.
 */
function CatchUpPopup({
  streak,
  owed,
  today,
  onPlayDate,
}: {
  streak: StreakState;
  owed: string[];
  today: string;
  onPlayDate?: (date: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const days = streak.currentStreak;
  const puzzles = owed.map((date) => dayLabel(date, today));
  const which = puzzles.length === 1 ? `${puzzles[0]} puzzle` : `${puzzles.join(" and ")} puzzles`;
  return (
    <span className="streak-display__catch-up" role="status">
      <button
        type="button"
        className="streak-display__catch-up-close"
        aria-label="Close"
        onClick={() => setOpen(false)}
      >
        ×
      </button>
      <strong>
        Save your {days}-day streak <span aria-hidden="true">⚠️</span>
      </strong>
      <span>
        You're out of 🧊 freezes. Play {which} before today's and your streak lives on.
      </span>
      {onPlayDate && (
        <span className="streak-display__catch-up-actions">
          {owed.map((date) => (
            <button
              key={date}
              type="button"
              className="streak-display__catch-up-play"
              onClick={() => onPlayDate(date)}
            >
              Play {dayLabel(date, today)}
            </button>
          ))}
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
  /** Open a missed day's puzzle, from the catch-up popup's buttons. */
  onPlayDate?: (date: string) => void;
}

export function StreakDisplay({
  streak,
  totalRarity = 0,
  date,
  isToday = false,
  hideEmpty = false,
  hasWords = true,
  onPlayDate,
}: Props) {
  // One icon for how the streak stands, as the streak board marks it (see
  // components/LeaderboardPage.tsx): ⚠️ when missed days are owed, every
  // saved freeze spent, and the streak lives only if they are made up; 😴 on
  // an earned Saturday not played yet, which cannot end the streak; ⏳ when
  // missing today puts the streak in danger, every saved freeze spent; 🧊
  // while a saved freeze is covering a missed day with one left for today,
  // until today is played; 🔥 otherwise. A past puzzle whose day a freeze
  // covered shows 🧊 too: that day the streak was kept by a freeze, not by play.
  const owed = isToday && date !== undefined ? catchUpDays(streak, date) : [];
  const danger = owed.length > 0;
  const restDay = !danger && isToday && date !== undefined && resting(streak, date);
  const frozen =
    !danger && !restDay && isToday && date !== undefined && savedFreezeCovering(streak, date);
  const risky = !danger && !restDay && isToday && date !== undefined && atRisk(streak, date);
  const coveredDay = !isToday && date !== undefined && wasFrozen(streak, date);
  const icon = danger
    ? "⚠️"
    : risky
      ? "⏳"
      : frozen || coveredDay
        ? "🧊"
        : streak.currentStreak >= 2
          ? "🔥"
          : null;
  const iconTitle = danger
    ? "Out of freezes: play the missed puzzle before today's to save your streak"
    : coveredDay
      ? "A freeze kept your streak alive on this day"
      : risky
        ? frozen
          ? "A saved freeze is covering your streak, and none is left: play today to keep it safe"
          : "No freeze left: play today to keep your streak safe"
        : frozen
          ? "A saved freeze is covering your streak"
          : undefined;
  // Sunday to Friday, the week's progress towards a lazy Saturday (a pie, or
  // 😴 once unlocked), beside the freezes. Only for a live streak, which is
  // what a lazy Saturday keeps.
  const week =
    isToday && date !== undefined && streak.currentStreak > 0 ? weekdayRestProgress(streak, date) : null;
  // A past puzzle shows the freezes held on its day; today's shows today's.
  const { banked, cap } = freezesOn(streak, isToday ? undefined : date);
  // Hidden only before the player can hold a freeze at all. The cap is set by
  // the longest streak ever, so a player whose streak has ended still has one
  // to show, and the row stays for it.
  const showFreezes = !hideEmpty || cap > 0;
  const showTotal = !hideEmpty || hasWords;
  const showStreak =
    !hideEmpty || streak.currentStreak > 0 || frozen || risky || danger || cap > 0;
  if (!showStreak && !showTotal) return null;
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        (restDay ? "Lazy Saturday: skipping today can't break your streak. " : "") +
        (coveredDay ? "A freeze kept your streak alive on this day. " : "") +
        (frozen ? "A saved freeze is covering your streak. " : "") +
        (risky ? "Play today to keep your streak. " : "") +
        (danger ? "Out of freezes: play the missed puzzle before today's to save your streak. " : "") +
        `Streak freezes: ${banked} of ${cap}. ` +
        `This puzzle's total score: ${totalRarity.toFixed(1)}.`
      }
    >
      {showStreak && (
        <div className="streak-display__row">
          {restDay ? (
            <RestDayBadge className="streak-display__flame" />
          ) : icon && (
            <span className="streak-display__flame" aria-hidden="true" title={iconTitle}>
              {icon}
            </span>
          )}
          <span className="streak-display__count-wrap">
            {danger && date !== undefined && (
              <CatchUpPopup streak={streak} owed={owed} today={date} onPlayDate={onPlayDate} />
            )}
            <span className="streak-display__count">{streak.currentStreak}</span>
          </span>
          <span className="streak-display__unit">day streak</span>
          {showFreezes && <FreezeBadge banked={banked} cap={cap} />}
          {week && (
            <RestDayBadge played={week.played} reachable={week.reachable} className="streak-display__week" />
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
