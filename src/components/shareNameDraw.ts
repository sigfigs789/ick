import { isReporting, trackShareNameAssigned } from "../analytics";
import { hasChosenShowName } from "../game/shareName";
import { assignShareNameArm, forcedShareNameVariant } from "../game/shareNameTest";
import { playedBefore } from "../game/storage";

/**
 * Draw the player into the share name test (see game/shareNameTest.ts) as a
 * share is built, so `loadShowName` reads their arm's default. Only a player
 * who has never set the "Show username" toggle is drawn, and the draw is
 * reported once, marked new or returning. A forced arm is read by
 * `loadShowName` without a draw, and a host that reports nothing (the Reddit
 * post) has nobody to measure one, so it keeps the old default and never draws.
 */
export function drawShareName(date: string): void {
  if (hasChosenShowName() || forcedShareNameVariant() || !isReporting()) return;
  const drawn = assignShareNameArm();
  if (drawn?.fresh) trackShareNameAssigned(drawn.variant, date, playedBefore(date));
}
