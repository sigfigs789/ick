import { useLayoutEffect, useState } from "react";
import { isReporting, trackInputPlacementAssigned } from "../analytics";
import {
  assignInputPlacementArm,
  drawnInputPlacementArm,
  forcedInputPlacementVariant,
  type InputPlacementVariant,
} from "../game/inputPlacementTest";
import { playedBefore } from "../game/storage";

/**
 * Where the guess input sits on the puzzle at `date`: above the guess log or
 * below it (see game/inputPlacementTest.ts). The player is drawn here the first
 * time the input is `showing` -- an unfinished puzzle -- and the draw is
 * reported once, marked new or returning. A forced arm is used without a draw,
 * and a host that reports nothing (the Reddit post) has nobody to measure one,
 * so it keeps the input above and never draws.
 *
 * Decided before paint, so a fresh draw of `below` does not flash the input
 * above the log first.
 */
export function useInputPlacement(date: string, showing: boolean): InputPlacementVariant {
  const [placement, setPlacement] = useState<InputPlacementVariant>(
    () => forcedInputPlacementVariant() ?? (isReporting() ? drawnInputPlacementArm() : null) ?? "above"
  );

  useLayoutEffect(() => {
    if (!showing) return;
    const forced = forcedInputPlacementVariant();
    if (forced || !isReporting()) {
      setPlacement(forced ?? "above");
      return;
    }
    const drawn = assignInputPlacementArm();
    if (!drawn) {
      setPlacement("above");
      return;
    }
    if (drawn.fresh) trackInputPlacementAssigned(drawn.variant, date, playedBefore(date));
    setPlacement(drawn.variant);
  }, [date, showing]);

  return placement;
}
