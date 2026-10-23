import { streakGoal } from "../game/comeBack";
import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
}

/**
 * Under today's banked word: what playing tomorrow does for the streak (see
 * game/comeBack.ts for why it is here).
 */
export function ComeBackCard({ streak }: Props) {
  const goal = streakGoal(streak);
  return (
    <section className="come-back" aria-label="Tomorrow's drop">
      <p className="come-back__goal">
        <span aria-hidden="true">🔥 </span>
        {goal.headline}
      </p>
      {goal.detail && <p className="come-back__detail">{goal.detail}</p>}
    </section>
  );
}
