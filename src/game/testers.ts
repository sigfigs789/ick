import { handleFor } from "./handle";
import { accountName, loadPlayerId } from "./player";

/**
 * Players put in the new arm of both experiments by hand: the reworked play
 * screen (see game/uiVariant.ts) and the idle hint (see game/idleHint.ts).
 *
 * Listed by handle, the name the board shows, since that is the name anyone
 * asking to be let in knows themselves by. Like a `?ui=` or `?idle-hint=`
 * force, a tester's arm is never stored or reported, so it cannot skew either
 * split; and it follows the player to any browser their id is transferred to,
 * which a query string does not.
 *
 * Browser players only: an account (the Reddit post) is not given a handle.
 */
export const TESTER_HANDLES: ReadonlySet<string> = new Set(["NorthernBear87"]);

/** Whether this browser's player is one of the hand-picked testers. */
export function isTester(): boolean {
  if (accountName()) return false;
  const id = loadPlayerId();
  return id !== null && TESTER_HANDLES.has(handleFor(id));
}
