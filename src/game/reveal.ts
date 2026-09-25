import type { RevealMode } from "./share";

/**
 * The results panel's "Show answers" choice, remembered across puzzles.
 *
 * A player who shares spoiler-free (or names every word) does it every day, so
 * resetting the toggle to "Top" each time made them pick again before every
 * share. It is a player setting, like the game mode in game/mode.ts, and lives
 * in the same storage: on the phone that is the localStorage shim in
 * native/src/host/storage.ts, so web and app share this one module.
 */

/**
 * "Top", for a player who has never touched the toggle: name the rarest word as
 * a low-stakes flex and keep the rest anonymous. "Hide" stays available for a
 * fully spoiler-free share.
 */
export const DEFAULT_REVEAL: RevealMode = "top";

const REVEAL_KEY = "ick:reveal";

function isReveal(value: unknown): value is RevealMode {
  return value === "none" || value === "top" || value === "all";
}

/**
 * The remembered choice, or the default when there is none -- including when
 * storage cannot be read or holds something this version does not recognise.
 */
export function loadReveal(): RevealMode {
  try {
    const stored = localStorage.getItem(REVEAL_KEY);
    return isReveal(stored) ? stored : DEFAULT_REVEAL;
  } catch {
    return DEFAULT_REVEAL;
  }
}

export function saveReveal(reveal: RevealMode): void {
  try {
    localStorage.setItem(REVEAL_KEY, reveal);
  } catch {
    // A browser that cannot remember the choice still honours it for this
    // render; the next puzzle just starts from the default again.
  }
}
