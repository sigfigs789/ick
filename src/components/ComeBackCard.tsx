import { streakGoal } from "../game/comeBack";
import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
}

/**
 * Under the streak strip once today's word is banked: what playing tomorrow
 * does for the streak (see game/comeBack.ts for why it is here). No 🔥 of its
 * own -- the strip right above it already wears one.
 */
export function ComeBackCard({ streak }: Props) {
  const goal = streakGoal(streak);
  return (
    <section className="come-back" aria-label="Tomorrow's drop">
      <p className="come-back__goal">{goal.headline}</p>
      {goal.detail && <p className="come-back__detail">{goal.detail}</p>}
    </section>
  );
}
