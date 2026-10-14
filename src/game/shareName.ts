/**
 * The results panel's "Show username" choice, remembered across puzzles.
 *
 * A shared result says who played it ("Playing as StormyFox47"), which is what
 * lets a friend find the sharer on the board. Some players would rather not put
 * their handle on every post, so it can be switched off -- and like the "Show
 * answers" choice in game/reveal.ts, a player who switches it off once means it
 * every day, so it lives in the same storage rather than resetting per puzzle.
 */

/** On, for a player who has never touched the toggle. */
export const DEFAULT_SHOW_NAME = true;

const SHOW_NAME_KEY = "ick:share-name";

/**
 * The remembered choice, or the default when there is none -- including when
 * storage cannot be read or holds something this version does not recognise.
 */
export function loadShowName(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_NAME_KEY);
    if (stored === "show") return true;
    if (stored === "hide") return false;
    return DEFAULT_SHOW_NAME;
  } catch {
    return DEFAULT_SHOW_NAME;
  }
}

export function saveShowName(show: boolean): void {
  try {
    localStorage.setItem(SHOW_NAME_KEY, show ? "show" : "hide");
  } catch {
    // A browser that cannot remember the choice still honours it for this
    // render; the next puzzle just starts from the default again.
  }
}
