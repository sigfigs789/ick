import { useLayoutEffect, useState } from "react";
import { isReporting, trackShareFlamesAssigned } from "../analytics";
import {
  assignShareFlamesArm,
  drawnShareFlamesArm,
  forcedShareFlamesVariant,
  shareFlameTier,
  type FlameTier,
  type ShareFlamesVariant,
} from "../game/shareFlamesTest";
import { playedBefore } from "../game/storage";
import type { AcceptedWord } from "../game/types";

/**
 * The tier the Share buttons burn in for the puzzle at `date`, or null for no
 * flames (see game/shareFlamesTest.ts). The player is drawn here the first time
 * `words` average Extremely Rare or better -- the App only renders this while a
 * Share button is on the page -- and the draw is reported once, marked new or
 * returning. A forced arm is used without a draw, and a host that reports
 * nothing (the Reddit post) has nobody to measure one, so it keeps the plain
 * buttons and never draws.
 *
 * Decided before paint, so a fresh draw of `shown` does not light a frame late.
 */
export function useShareFlames(words: readonly AcceptedWord[], date: string): FlameTier | null {
  const tier = shareFlameTier(words, date);
  const burning = tier !== null;
  const [variant, setVariant] = useState<ShareFlamesVariant>(
    () => forcedShareFlamesVariant() ?? (isReporting() ? drawnShareFlamesArm() : null) ?? "hidden"
  );

  useLayoutEffect(() => {
    if (!burning) return;
    const forced = forcedShareFlamesVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "hidden");
      return;
    }
    const drawn = assignShareFlamesArm();
    if (!drawn) {
      setVariant("hidden");
      return;
    }
    if (drawn.fresh) trackShareFlamesAssigned(drawn.variant, date, playedBefore(date));
    setVariant(drawn.variant);
  }, [date, burning]);

  return variant === "shown" ? tier : null;
}
