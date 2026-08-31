import { formatScore } from "../game/dictionary";
import type { StreakState } from "../game/types";

/** What the two tier counters count, said once for the tooltip and the label. */
const CRUSHED_IT_TITLE = "Days you found a Rare word or better";
const ELITE_TITLE = "Days you found an Extremely Rare word or better";

interface Props {
  streak: StreakState;
  totalRarity?: number;
  topRarity?: number;
  /** Puzzle date, so the top score formats for the scoring system in effect that day. */
  date?: string;
}

export function StreakDisplay({ streak, totalRarity = 0, topRarity = 0, date }: Props) {
  return (
    <div
      className="streak-display"
      aria-label={
        `Current streak: ${streak.currentStreak} days. ` +
        `${CRUSHED_IT_TITLE}: ${streak.crushedIt}. ` +
        `${ELITE_TITLE}: ${streak.elite}. ` +
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
      </div>
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
