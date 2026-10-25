import { isReporting, trackShareNameAssigned, trackShareNameToggled } from "../analytics";
import { hasChosenShowName } from "../game/shareName";
import { assignShareNameArm, drawnShareNameArm, forcedShareNameVariant } from "../game/shareNameTest";
import { playedBefore } from "../game/storage";

/**
 * Draw the player into the share name test (see game/shareNameTest.ts) as a
 * share is built, so `loadShowName` reads their arm's default. Only a player
 * who has never set the "Show username" toggle, and was not kept out at
 * startup for having set it before the test, is drawn, and the draw is
 * reported once, marked new or returning. A forced arm is read by
 * `loadShowName` without a draw, and a host that reports nothing (the Reddit
 * post) has nobody to measure one, so it keeps the old default and never draws.
 */
export function drawShareName(date: string): void {
  if (hasChosenShowName() || forcedShareNameVariant() || !isReporting()) return;
  const drawn = assignShareNameArm();
  if (drawn?.fresh) trackShareNameAssigned(drawn.variant, date, playedBefore(date));
}

/**
 * Report a drawn player setting the toggle. Their choice wins from here on,
 * but they keep their arm, so the test stays intent-to-treat; this records the
 * override against the arm. Nothing for a forced arm, or a player never drawn.
 */
export function reportShareNameToggle(show: boolean, date: string): void {
  if (forcedShareNameVariant()) return;
  const arm = drawnShareNameArm();
  if (arm) trackShareNameToggled(arm, show, date);
}
