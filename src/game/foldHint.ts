import { playedPuzzleCount } from "./storage";

/**
 * Who sees FoldHint, the notice over the input that a word will score as its
 * common form. Kept out of the component so the "de-" notice can ask too.
 */

/** Remembered once the player has closed the notice or opened its More info. */
const SEEN_KEY = "ick:fold-hint";
/** Also put away: More info is the same explainer the "de-" notice opens. */
const DE_PREFIX_SEEN_KEY = "ick:de-prefix-hint";

/**
 * How many puzzles a player is new for. Counted at the start of a puzzle, so
 * the notice does not vanish mid-word when the first word banks.
 */
const NEW_PLAYER_PUZZLES = 3;

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function markFoldHintSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
    localStorage.setItem(DE_PREFIX_SEEN_KEY, "1");
  } catch {
    // Private mode: the notice comes back next visit, which is harmless.
  }
}

/**
 * Whether this player would still be shown the notice: new, and has not put it
 * away. The "de-" notice stands down for them, because "will now rescore" is
 * news only to a player who saw it score the old way.
 */
export function foldHintEligible(): boolean {
  return !seen() && playedPuzzleCount() < NEW_PLAYER_PUZZLES;
}
