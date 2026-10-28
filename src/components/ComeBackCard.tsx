import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isReporting, trackComeBackAssigned } from "../analytics";
import { syncAchievements } from "../game/achievements";
import { comeBackGoal, type GoalExplainer } from "../game/comeBack";
import { assignComeBackArm, forcedComeBackVariant, type ComeBackVariant } from "../game/comeBackTest";
import type { StreakState } from "../game/types";

interface Props {
  streak: StreakState;
  /** The puzzle on screen, which the draw is reported against. */
  date: string;
}

/**
 * Under the footnotes divider, just above yesterday's best, once today's word
 * is banked: what playing tomorrow is worth, in one line (see game/comeBack.ts).
 *
 * Shown to the `shown` arm of the come-back test (see game/comeBackTest.ts),
 * which is drawn here, the first time the line would appear. A host that
 * reports nothing (the Reddit post) has nobody to measure a draw, so it
 * always shows the line and never draws.
 *
 * A line naming a 🧊 freeze or a lazy weekend can be selected for a popup
 * saying what that is (see `comeBackGoal`).
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
      comeBackGoal(
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
      {goal.explainer ? (
        <ExplainedGoal line={goal.line} explainer={goal.explainer} />
      ) : (
        <p className="come-back__goal">{goal.line}</p>
      )}
    </section>
  );
}

/**
 * The line as a button opening a popup with what its reward is; selecting it
 * again, anywhere outside it, or Escape closes it, as the freeze badge does.
 */
function ExplainedGoal({ line, explainer }: { line: string; explainer: GoalExplainer }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
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
    <div className="come-back__wrap" ref={wrapRef}>
      <button
        type="button"
        className="come-back__goal come-back__button"
        aria-expanded={open}
        aria-controls={popupId}
        onClick={() => setOpen((was) => !was)}
      >
        {line}
      </button>
      {open && (
        <span className="come-back__popup" id={popupId} role="dialog" aria-label={explainer.title}>
          <strong>{explainer.title}</strong>
          <span>{explainer.text}</span>
        </span>
      )}
    </div>
  );
}
