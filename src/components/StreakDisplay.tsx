import { formatScore } from "../game/dictionary";
import { addDays } from "../game/date";
import { wasFrozen } from "../game/streakFreeze";
import type { StreakState } from "../game/types";

/** What the two tier counters count, said once for the tooltip and the label. */
const CRUSHED_IT_TITLE = "Days you found a Rare word or better";
const ELITE_TITLE = "Days you found an Extremely Rare word or better";
const FREEZE_TITLE = "Streak freezes: each one covers a missed day";

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
  const freezes = streak.freezes ?? 0;
  const savedYesterday =
    isToday &&
    date !== undefined &&
    streak.currentStreak > 0 &&
    streak.lastCompletedDate !== date &&
    wasFrozen(streak, addDays(date, -1));
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        `${CRUSHED_IT_TITLE}: ${streak.crushedIt}. ` +
        `${ELITE_TITLE}: ${streak.elite}. ` +
        (freezes > 0 ? `${FREEZE_TITLE}: ${freezes}. ` : "") +
        `This puzzle's total score: ${totalRarity.toFixed(1)}. ` +
        `Rarest word so far: ${formatScore(topRarity, date)}.`
      }
    >
      <div className="streak-display__row">
        {streak.currentStreak >= 2 ? (
          <span className="streak-display__flame" aria-hidden="true">
            🔥
          </span>
        ) : null}
        <span className="streak-display__count">{streak.currentStreak}</span>
        <span className="streak-display__unit">day streak</span>
        <span className="streak-display__tracker" title={CRUSHED_IT_TITLE}>
          <span className="streak-display__count">{streak.crushedIt}</span>
          <span className="streak-display__unit">Crushed it</span>
        </span>
        <span className="streak-display__tracker" title={ELITE_TITLE}>
          <span className="streak-display__count">{streak.elite}</span>
          <span className="streak-display__unit">Elite</span>
        </span>
        {freezes > 0 && (
          <span className="streak-display__tracker" title={FREEZE_TITLE}>
            <span aria-hidden="true">🧊</span>
            <span className="streak-display__count">{freezes}</span>
            <span className="streak-display__unit">{freezes === 1 ? "Freeze" : "Freezes"}</span>
          </span>
        )}
      </div>
      {savedYesterday && (
        <p className="streak-display__saved">
          A streak freeze covered yesterday. Play today to keep it going.
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
