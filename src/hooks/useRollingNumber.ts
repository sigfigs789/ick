import { useEffect, useState } from "react";
import { rollingValue } from "../game/celebration";

/** How long a score takes to roll up to its value, in ms. */
export const ROLL_MS = 750;

/**
 * Whether motion is welcome here. Answers no where it cannot ask -- a test
 * environment without `matchMedia` -- so the number simply shows its value.
 */
function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * `target`, rolled up from zero over `ROLL_MS` while `rolling` is set -- the
 * slot-reel count a freshly scored word's number makes before it lands. Shows
 * `target` outright when not rolling, or when the player prefers less motion.
 */
export function useRollingNumber(target: number, rolling: boolean): number {
  const [value, setValue] = useState(() => (rolling && motionAllowed() ? 0 : target));

  useEffect(() => {
    if (!rolling || !motionAllowed()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = (now - start) / ROLL_MS;
      setValue(rollingValue(target, progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, rolling]);

  return value;
}
