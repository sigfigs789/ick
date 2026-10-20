import { useEffect, useId, useRef, useState } from "react";
import { atRisk, savedFreezeCovering, streakFreezeCap } from "../game/streakFreeze";
import type { StreakState } from "../game/types";

/** How saved freezes work, for the freeze badge's popup. */
const FREEZE_RULES =
  "🧊 keeps your streak alive for one more day. Earn an 🧊 every 7 days played. " +
  "You can hold 1 🧊 after a 14 day streak and 2 🧊 after a 30 day streak.";

function freezeSummary(banked: number, cap: number): string {
  if (banked === 0) return "No 🧊 acquired";
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

interface Props {
  streak: StreakState;
  totalRarity?: number;
  /** Puzzle date, which decides whether today's freeze state is shown. */
  date?: string;
  /** Whether `date` is today's puzzle, which is when a freeze spent yesterday is news. */
  isToday?: boolean;
  /**
   * The new play screen (see game/uiVariant.ts): leave out what would only be
   * zeros -- the freeze badge until a freeze is held, the total until a word
   * is banked, and the whole strip for a player with neither a streak nor a
   * word yet.
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
  // components/LeaderboardPage.tsx): 🧊 while a saved freeze is covering a
  // missed day, until today is played; ⏳ when missing today ends the streak;
  // 🔥 otherwise, the free missed day with a freeze to spare included.
  const frozen = isToday && date !== undefined && savedFreezeCovering(streak, date);
  const risky = isToday && date !== undefined && atRisk(streak, date);
  const icon = frozen ? "🧊" : risky ? "⏳" : streak.currentStreak >= 2 ? "🔥" : null;
  const iconTitle = frozen
    ? risky
      ? "A saved freeze is covering your streak, and none is left: play today to keep it"
      : "A saved freeze is covering your streak"
    : risky
      ? "You missed yesterday: play today to keep your streak"
      : undefined;
  const banked = streak.bankedFreezes ?? 0;
  const cap = streakFreezeCap(streak);
  const showFreezes = !hideEmpty || banked > 0;
  const showTotal = !hideEmpty || hasWords;
  const showStreak = !hideEmpty || streak.currentStreak > 0 || frozen || risky;
  if (!showStreak && !showTotal) return null;
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        (frozen ? "A saved freeze is covering your streak. " : "") +
        (risky ? "Play today to keep your streak. " : "") +
        `Streak freezes: ${banked} of ${cap}. ` +
        `This puzzle's total score: ${totalRarity.toFixed(1)}.`
      }
    >
      {showStreak && (
        <div className="streak-display__row">
          {icon && (
            <span className="streak-display__flame" aria-hidden="true" title={iconTitle}>
              {icon}
            </span>
          )}
          <span className="streak-display__count">{streak.currentStreak}</span>
          <span className="streak-display__unit">day streak</span>
          {showFreezes && <FreezeBadge banked={banked} cap={cap} />}
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
