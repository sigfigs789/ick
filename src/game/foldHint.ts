import { foldAffixGroups } from "./dictionary";
import type { GameMode } from "./mode";
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

/**
 * Letters a suffix needs in front of it before it reads as one. Without a
 * stem, "-s" would claim "is" and "-er" would claim "her".
 */
const MIN_STEM = 2;

/**
 * The affix in `value` the fold reads through on `date`'s puzzle in `mode`,
 * written the way the Common forms sheet lists it ("de-", "-ness"). A prefix
 * counts the moment it is typed, so "de" is caught before "deser..." gets any
 * further; a suffix once there is a stem in front of it. The longest of each
 * wins ("-iest" over "-est"). An opening wins over an ending, so the notice
 * "de" put up stays put through "deser", which ends in "-er" only by the way.
 *
 * Read off `foldAffixGroups`, the same date-scoped list the sheet shows, so
 * the notice never names an affix the sheet it opens leaves out. Empty in
 * Freeform, which folds nothing.
 */
export function typedFoldAffix(value: string, date?: string, mode?: GameMode): string | undefined {
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  const affixes = foldAffixGroups(date, mode).flatMap((group) => group.affixes);
  const longest = (matches: string[]) =>
    matches.sort((a, b) => b.length - a.length)[0] as string | undefined;

  const prefix = longest(
    affixes.filter((affix) => affix.endsWith("-") && text.startsWith(affix.slice(0, -1)))
  );
  if (prefix) return prefix;
  return longest(
    affixes.filter((affix) => {
      if (!affix.startsWith("-")) return false;
      const ending = affix.slice(1);
      return text.endsWith(ending) && text.length - ending.length >= MIN_STEM;
    })
  );
}
