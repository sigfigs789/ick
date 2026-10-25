import { drawnShareNameArm, forcedShareNameVariant } from "./shareNameTest";

/**
 * The results panel's "Show username" choice, remembered across puzzles.
 *
 * A shared result says who played it ("Playing as StormyFox47"), which is what
 * lets a friend find the sharer on the board. Some players would rather not put
 * their handle on every post, so it can be switched off -- and like the "Show
 * answers" choice in game/reveal.ts, a player who switches it off once means it
 * every day, so it lives in the same storage rather than resetting per puzzle.
 *
 * A player who has never touched the toggle gets the default their arm of the
 * share name test sets (see game/shareNameTest.ts), and `DEFAULT_SHOW_NAME`
 * before they are drawn or when they are left out of it.
 */

/** On, for a player who has never touched the toggle and is not in the test. */
export const DEFAULT_SHOW_NAME = true;

const SHOW_NAME_KEY = "ick:share-name";

function storedShowName(): boolean | null {
  try {
    const stored = localStorage.getItem(SHOW_NAME_KEY);
    if (stored === "show") return true;
    if (stored === "hide") return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether the player has set the toggle themselves -- the one thing that keeps
 * them out of the share name test.
 */
export function hasChosenShowName(): boolean {
  return storedShowName() !== null;
}

/**
 * The remembered choice, or the default when there is none -- including when
 * storage cannot be read or holds something this version does not recognise.
 */
export function loadShowName(): boolean {
  const stored = storedShowName();
  if (stored !== null) return stored;
  const arm = forcedShareNameVariant() ?? drawnShareNameArm();
  return arm ? arm === "shown" : DEFAULT_SHOW_NAME;
}

export function saveShowName(show: boolean): void {
  try {
    localStorage.setItem(SHOW_NAME_KEY, show ? "show" : "hide");
  } catch {
    // A browser that cannot remember the choice still honours it for this
    // render; the next puzzle just starts from the default again.
  }
}
