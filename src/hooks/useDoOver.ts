import { useLayoutEffect, useState } from "react";
import { isReporting, trackDoOverAssigned } from "../analytics";
import { assignDoOverArm, drawnDoOverArm, forcedDoOverVariant, type DoOverVariant } from "../game/doOverTest";
import { playedBefore } from "../game/storage";

/**
 * Whether this player gets the do-over (see game/doOver.ts), read without
 * drawing: a forced arm, else the arm already drawn. A host that reports
 * nothing (the Reddit post) has nobody to measure a draw, so it gets none.
 */
export function doOverOn(): boolean {
  return (forcedDoOverVariant() ?? (isReporting() ? drawnDoOverArm() : null)) === "shown";
}

/**
 * Whether this player gets the do-over, drawing them into the do-over test
 * (see game/doOverTest.ts) the first time `eligible` -- the pie would appear --
 * and reporting the draw once, marked new or returning.
 *
 * Decided before paint, so a fresh draw of `shown` does not add the pie a frame late.
 */
export function useDoOver(eligible: boolean, date: string): boolean {
  const [variant, setVariant] = useState<DoOverVariant>(() => (doOverOn() ? "shown" : "hidden"));

  useLayoutEffect(() => {
    if (!eligible) return;
    const forced = forcedDoOverVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "hidden");
      return;
    }
    const drawn = assignDoOverArm();
    if (!drawn) {
      setVariant("hidden");
      return;
    }
    if (drawn.fresh) trackDoOverAssigned(drawn.variant, date, playedBefore(date));
    setVariant(drawn.variant);
  }, [date, eligible]);

  return variant === "shown";
}
