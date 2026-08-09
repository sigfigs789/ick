import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
}

export function StreakDisplay({ streak }: Props) {
  return (
    <div className="streak-display" aria-label={`Current streak: ${streak.currentStreak} days`}>
      <span className="streak-display__flame" aria-hidden="true">
        🔥
      </span>
      <span className="streak-display__count">{streak.currentStreak}</span>
      <span className="streak-display__unit">day streak</span>
    </div>
  );
}
