import { useState } from "react";
import { formatScore } from "../game/dictionary";
import { atRisk, freezeCap, isFrozen } from "../game/streakFreeze";
import type { StreakState } from "../game/types";

/** What the two tier counters count, said once for the tooltip and the label. */
const CRUSHED_IT_TITLE = "Days you found a Rare word or better";
const ELITE_TITLE = "Days you found an Extremely Rare word or better";

/** How saved freezes work, for the freeze badge's tooltip and its click-open note. */
const FREEZE_RULES =
  "A saved freeze covers a missed day after your one free day. You earn one " +
  "for every 7 days of your streak, and can hold 1 from a 14-day streak and 2 from 30 days.";

function freezeSummary(banked: number, cap: number): string {
  if (cap === 0) return "No saved freezes yet.";
  return `${banked} of ${cap} saved ${cap === 1 ? "freeze" : "freezes"}.`;
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
  const [showFreezes, setShowFreezes] = useState(false);
  // Yesterday was missed and covered by a freeze: the flame turns to ice until
  // today is played. At risk when no saved freeze is left to cover today too.
  const frozen = isToday && date !== undefined && isFrozen(streak, date);
  const risky = isToday && date !== undefined && atRisk(streak, date);
  const banked = streak.bankedFreezes ?? 0;
  const cap = freezeCap(streak.currentStreak);
  const freezeNote = `${freezeSummary(banked, cap)} ${FREEZE_RULES}`;
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        `${CRUSHED_IT_TITLE}: ${streak.crushedIt}. ` +
        `${ELITE_TITLE}: ${streak.elite}. ` +
        (frozen ? "Streak frozen: play today to keep it. " : "") +
        `${freezeSummary(banked, cap)} ` +
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
        <button
          type="button"
          className="streak-display__freezes"
          title={freezeNote}
          aria-expanded={showFreezes}
          aria-label={`Saved streak freezes: ${freezeSummary(banked, cap)}`}
          onClick={() => setShowFreezes((open) => !open)}
        >
          <span aria-hidden="true">❄️</span>
          <span className="streak-display__count">
            {banked}/{cap}
          </span>
        </button>
        <span className="streak-display__tracker" title={CRUSHED_IT_TITLE}>
          <span className="streak-display__count">{streak.crushedIt}</span>
          <span className="streak-display__unit">Crushed it</span>
        </span>
        <span className="streak-display__tracker" title={ELITE_TITLE}>
          <span className="streak-display__count">{streak.elite}</span>
          <span className="streak-display__unit">Elite</span>
        </span>
      </div>
      {showFreezes && <p className="streak-display__saved">{freezeNote}</p>}
      {frozen && (
        <p className="streak-display__saved">
          {risky
            ? "You missed yesterday, so your streak is frozen. Play today to keep it going."
            : "You missed yesterday, so your streak is frozen. Play today to keep it going, " +
              "or a saved freeze will cover today."}
        </p>
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
