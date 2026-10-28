import { useLayoutEffect, useState } from "react";
import { isReporting, trackShareTintAssigned } from "../analytics";
import {
  assignShareTintArm,
  drawnShareTintArm,
  forcedShareTintVariant,
  shareTinted,
  type ShareTintVariant,
} from "../game/shareTintTest";
import { playedBefore } from "../game/storage";
import type { AcceptedWord } from "../game/types";

/**
 * Whether the Share buttons take the Extremely Rare colour for the puzzle at
 * `date` (see game/shareTintTest.ts). The player is drawn here the first time
 * `words` average Extremely Rare -- the App only renders this while a Share
 * button is on the page -- and the draw is reported once, marked new or
 * returning. A forced arm is used without a draw, and a host that reports
 * nothing (the Reddit post) has nobody to measure one, so it keeps the plain
 * buttons and never draws.
 *
 * Decided before paint, so a fresh draw of `shown` does not tint a frame late.
 */
export function useShareTint(words: readonly AcceptedWord[], date: string): boolean {
  const tinted = shareTinted(words, date);
  const [variant, setVariant] = useState<ShareTintVariant>(
    () => forcedShareTintVariant() ?? (isReporting() ? drawnShareTintArm() : null) ?? "hidden"
  );

  useLayoutEffect(() => {
    if (!tinted) return;
    const forced = forcedShareTintVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "hidden");
      return;
    }
    const drawn = assignShareTintArm();
    if (!drawn) {
      setVariant("hidden");
      return;
    }
    if (drawn.fresh) trackShareTintAssigned(drawn.variant, date, playedBefore(date));
    setVariant(drawn.variant);
  }, [date, tinted]);

  return tinted && variant === "shown";
}
