import { useLayoutEffect, useState } from "react";
import { isReporting, trackPlayTabAssigned } from "../analytics";
import { todayDateString } from "../game/date";
import {
  assignPlayTabArm,
  drawnPlayTabArm,
  forcedPlayTabVariant,
  type PlayTabVariant,
} from "../game/playTabTest";
import { playedBefore } from "../game/storage";

/**
 * Whether the header shows the Play icon (see game/playTabTest.ts). The player
 * is drawn here, on the first load, and the draw is reported once, marked new
 * or returning. A forced arm is used without a draw, and a host that reports
 * nothing (the Reddit post) has nobody to measure one, so it keeps the bar
 * without the icon and never draws.
 *
 * Decided before paint, so a fresh draw of `shown` does not pop the icon in a
 * frame late.
 */
export function usePlayTab(): boolean {
  const [variant, setVariant] = useState<PlayTabVariant>(
    () => forcedPlayTabVariant() ?? (isReporting() ? drawnPlayTabArm() : null) ?? "hidden"
  );

  useLayoutEffect(() => {
    const forced = forcedPlayTabVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "hidden");
      return;
    }
    const drawn = assignPlayTabArm();
    if (!drawn) {
      setVariant("hidden");
      return;
    }
    const today = todayDateString();
    if (drawn.fresh) trackPlayTabAssigned(drawn.variant, today, playedBefore(today));
    setVariant(drawn.variant);
  }, []);

  return variant === "shown";
}
