import { streakGoal } from "../game/comeBack";
import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
}

/**
 * Under the streak strip once today's word is banked: what playing tomorrow
 * is worth, in one line (see game/comeBack.ts for why it is here). No 🔥 of its
 * own -- the strip right above it already wears one.
 */
export function ComeBackCard({ streak }: Props) {
  return (
    <section className="come-back" aria-label="Tomorrow's drop">
      <p className="come-back__goal">{streakGoal(streak)}</p>
    </section>
  );
}
