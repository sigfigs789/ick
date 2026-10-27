import { handleFor } from "./handle";
import { accountName, loadPlayerId } from "./player";

/**
 * Players put in the new arm of every experiment by hand: the idle hint's
 * treatment (see game/idleHint.ts), and the come-back line and the word of the
 * day shown (see game/comeBackTest.ts and game/wordOfDay.ts), and the username
 * left out of shares by default (see game/shareNameTest.ts), and the Share
 * that wiggles after a great finish (see game/shareNudgeTest.ts). The
 * exceptions are the input placement test (see game/inputPlacementTest.ts),
 * where testers are kept in the old arm: the guess input above the guess log;
 * and the play tab test (see game/playTabTest.ts), where they are kept in the
 * hidden arm, with no Play icon in the header.
 *
 * Listed by handle, the name the board shows, since that is the name anyone
 * asking to be let in knows themselves by. Like an `?idle-hint=` force, a
 * tester's arm is never stored or reported, so it cannot skew the split; and
 * it follows the player to any browser their id is transferred to, which a
 * query string does not.
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
