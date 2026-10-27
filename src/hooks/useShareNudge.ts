import { useLayoutEffect, useState } from "react";
import { isReporting, trackShareNudgeAssigned } from "../analytics";
import {
  assignShareNudgeArm,
  earnsShareNudge,
  forcedShareNudgeVariant,
  type ShareNudgeVariant,
} from "../game/shareNudgeTest";
import { playedBefore } from "../game/storage";
import type { AcceptedWord } from "../game/types";

/**
 * Whether the Share beside the guess count wiggles (see
 * game/shareNudgeTest.ts). Only a finished live puzzle whose words average
 * Extremely Rare or better can be nudged, and only that moment draws the
 * player: anything short of it returns false without touching the test. The
 * draw is reported once, marked new or returning. A forced arm is used without
 * a draw, and a host that reports nothing (the Reddit post) has nobody to
 * measure one, so its Share sits still and it never draws.
 *
 * Decided before paint, so a fresh draw of `shown` starts the wiggle on the
 * first frame the finish is shown rather than one late.
 */
export function useShareNudge(
  date: string,
  isToday: boolean,
  completed: boolean,
  words: readonly AcceptedWord[]
): boolean {
  const eligible = isToday && completed && earnsShareNudge(words, date);
  const [variant, setVariant] = useState<ShareNudgeVariant | null>(null);

  useLayoutEffect(() => {
    if (!eligible) {
      setVariant(null);
      return;
    }
    const forced = forcedShareNudgeVariant();
    if (forced || !isReporting()) {
      setVariant(forced ?? "hidden");
      return;
    }
    const drawn = assignShareNudgeArm();
    if (!drawn) {
      setVariant("hidden");
      return;
    }
    if (drawn.fresh) trackShareNudgeAssigned(drawn.variant, date, playedBefore(date));
    setVariant(drawn.variant);
  }, [eligible, date]);

  return eligible && variant === "shown";
}
