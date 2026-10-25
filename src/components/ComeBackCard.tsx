import { useEffect, useMemo, useState } from "react";
import { isReporting, trackComeBackAssigned } from "../analytics";
import { syncAchievements } from "../game/achievements";
import { streakGoal } from "../game/comeBack";
import { assignComeBackArm, forcedComeBackVariant, type ComeBackVariant } from "../game/comeBackTest";
import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
  /** The puzzle on screen, which the draw is reported against. */
  date: string;
}

/**
 * Under the streak strip once today's word is banked: what playing tomorrow
 * is worth, in one line (see game/comeBack.ts for why it is here). No 🔥 of its
 * own -- the strip right above it already wears one.
 *
 * Shown to the `shown` arm of the come-back test (see game/comeBackTest.ts),
 * which is drawn here, the first time the line would appear. A host that
 * reports nothing (the Reddit post) has nobody to measure a draw, so it
 * always shows the line and never draws.
 */
export function ComeBackCard({ streak, date }: Props) {
  const [variant, setVariant] = useState<ComeBackVariant | null>(null);

  useEffect(() => {
    const forced = forcedComeBackVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "shown");
      return;
    }
    const drawn = assignComeBackArm();
    if (!drawn) {
      setVariant("shown");
      return;
    }
    if (drawn.fresh) trackComeBackAssigned(drawn.variant, date);
    setVariant(drawn.variant);
  }, [date]);

  // The achievements still locked, for when nothing nearer is ahead. Memoized:
  // reading them walks the stored history. The suggestion badges are left out:
  // they are not won by coming back to play.
  const goal = useMemo(
    () =>
      streakGoal(
        streak,
        date,
        syncAchievements(streak).filter(
          (status) => !status.earnedOn && !status.achievement.viaSuggestions
        )
      ),
    [streak, date]
  );

  if (variant !== "shown" || goal === null) return null;
  return (
    <section className="come-back" aria-label="Tomorrow's drop">
      <p className="come-back__goal">{goal}</p>
    </section>
  );
}
