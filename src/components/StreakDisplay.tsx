import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
}

export function StreakDisplay({ streak }: Props) {
  return (
    <div
      className="streak-display"
      aria-label={`Current streak: ${streak.currentStreak} days. Crushed it: ${streak.crushedIt}. Elite: ${streak.elite}. High score: ${streak.highScore.toFixed(1)}.`}
    >
      <div className="streak-display__row">
        {streak.currentStreak >= 2 ? (
          <span className="streak-display__flame" aria-hidden="true">
            🔥
          </span>
        ) : null}
        <span className="streak-display__count">{streak.currentStreak}</span>
        <span className="streak-display__unit">day streak</span>
        <span className="streak-display__tracker">
          <span className="streak-display__count">{streak.crushedIt}</span>
          <span className="streak-display__unit">Crushed it</span>
        </span>
        <span className="streak-display__tracker">
          <span className="streak-display__count">{streak.elite}</span>
          <span className="streak-display__unit">Elite</span>
        </span>
      </div>
      <div className="streak-display__high-score">
        <span>High score</span>
        <strong>{streak.highScore.toFixed(1)}</strong>
      </div>
    </div>
  );
}
