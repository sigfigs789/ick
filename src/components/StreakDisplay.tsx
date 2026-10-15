import { useEffect, useId, useRef, useState } from "react";
import { formatScore } from "../game/dictionary";
import { atRisk, freezeCap, savedFreezeCovering } from "../game/streakFreeze";
import type { StreakState } from "../game/types";

/** What the two tier counters count, said once for the tooltip and the label. */
const CRUSHED_IT_TITLE = "Days you found a Rare word or better";
const ELITE_TITLE = "Days you found an Extremely Rare word or better";

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
  topRarity?: number;
  /** Puzzle date, so the top score formats for the scoring system in effect that day. */
  date?: string;
  /** Whether `date` is today's puzzle, which is when a freeze spent yesterday is news. */
  isToday?: boolean;
}

export function StreakDisplay({
  streak,
  totalRarity = 0,
  topRarity = 0,
  date,
  isToday = false,
}: Props) {
  // The free missed day keeps the flame. Only a saved freeze covering a longer
  // gap turns it to ice, until today is played. At risk -- missing today ends
  // the streak -- is said in a line under it rather than with another icon.
  const frozen = isToday && date !== undefined && savedFreezeCovering(streak, date);
  const risky = isToday && date !== undefined && atRisk(streak, date);
  const banked = streak.bankedFreezes ?? 0;
  const cap = freezeCap(streak.currentStreak);
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        `${CRUSHED_IT_TITLE}: ${streak.crushedIt}. ` +
        `${ELITE_TITLE}: ${streak.elite}. ` +
        (frozen ? "A saved freeze is covering your streak. " : "") +
        (risky ? "Play today to keep your streak. " : "") +
        `Streak freezes: ${banked} of ${cap}. ` +
        `This puzzle's total score: ${totalRarity.toFixed(1)}. ` +
        `Rarest word so far: ${formatScore(topRarity, date)}.`
      }
    >
      <div className="streak-display__row">
        {frozen ? (
          <span className="streak-display__flame" aria-hidden="true">
            🧊
          </span>
        ) : streak.currentStreak >= 2 ? (
          <span className="streak-display__flame" aria-hidden="true">
            🔥
          </span>
        ) : null}
        <span className="streak-display__count">{streak.currentStreak}</span>
        <span className="streak-display__unit">day streak</span>
        <FreezeBadge banked={banked} cap={cap} />
        <span className="streak-display__tracker" title={CRUSHED_IT_TITLE}>
          <span className="streak-display__count">{streak.crushedIt}</span>
          <span className="streak-display__unit">Crushed it</span>
        </span>
        <span className="streak-display__tracker" title={ELITE_TITLE}>
          <span className="streak-display__count">{streak.elite}</span>
          <span className="streak-display__unit">Elite</span>
        </span>
      </div>
      {risky && (
        <p className="streak-display__saved">You missed yesterday. Play today to keep your streak.</p>
      )}
      <div className="streak-display__rarity-scores">
        <span className="streak-display__rarity-score">
          <span>Total</span>
          <strong>{totalRarity.toFixed(1)}</strong>
        </span>
        <span className="streak-display__rarity-score">
          <span>Top</span>
          <strong>{formatScore(topRarity, date)}</strong>
        </span>
      </div>
    </div>
  );
}
