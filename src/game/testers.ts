import { handleFor } from "./handle";
import { accountName, loadPlayerId } from "./player";
import { isVercelHost } from "./vercelHost";

/**
 * Players put in the new arm of every experiment by hand: the idle hint's
 * treatment (see game/idleHint.ts), and the come-back line and the word of the
 * day shown (see game/comeBackTest.ts and game/wordOfDay.ts).
 *
 * Listed by handle, the name the board shows, since that is the name anyone
 * asking to be let in knows themselves by. Like an `?idle-hint=` force, a
 * tester's arm is never stored or reported, so it cannot skew the split; and
 * it follows the player to any browser their id is transferred to, which a
 * query string does not.
 *
 * Browser players only: an account (the Reddit post) is not given a handle.
 *
 * Everyone on a Vercel preview or `*.vercel.app` alias is a tester too: the
 * people playing there are the people building the game (see vercelHost.ts),
 * and a preview is where a change is checked, so it should show every new arm
 * rather than whichever one a coin flip gave that browser. Nothing is reported
 * from those hosts anyway.
 */
export const TESTER_HANDLES: ReadonlySet<string> = new Set(["NorthernBear87"]);

/** Whether this browser's player is one of the hand-picked testers. */
export function isTester(): boolean {
  if (isVercelHost(window.location.hostname)) return true;
  if (accountName()) return false;
  const id = loadPlayerId();
  return id !== null && TESTER_HANDLES.has(handleFor(id));
}
