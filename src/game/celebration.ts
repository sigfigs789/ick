import { isWinningRarity } from "./rank";
import type { AcceptedWord, Rarity } from "./types";

/**
 * How loudly an accepted word is celebrated, by tier.
 *
 * The reward used to arrive once a day: confetti for the first Rare-or-better
 * word, and the same rising chime for everything after it. A player who went
 * on to find a Mythic got less fuss for it than for the Rare that came first.
 * Now every good word earns its own moment, and the rarer the word the bigger
 * the moment, so the top of the ladder feels like the top of the ladder:
 *
 *   - `none`  -- Very Common through Uncommon: the chime and the score roll.
 *   - `burst` -- Rare, Extremely Rare, Elusive: confetti.
 *   - `grand` -- Mythic and Legend: the grand confetti, a jackpot fanfare and
 *                the tier stamped across the screen.
 */
export type Celebration = "none" | "burst" | "grand";

export function celebrationFor(rarity: Rarity): Celebration {
  if (rarity === "Mythic" || rarity === "Legend") return "grand";
  return isWinningRarity(rarity) ? "burst" : "none";
}

/**
 * A vibration pattern for an accepted word, on devices that have one: a tap for
 * an ordinary word, a double for a good one, and a drum roll for a jackpot.
 * Kept short throughout -- this is a pat on the back, not a ringtone.
 */
export function hapticPatternFor(rarity: Rarity): number[] {
  switch (celebrationFor(rarity)) {
    case "grand":
      return [30, 40, 30, 40, 60, 60, 120];
    case "burst":
      return [25, 50, 45];
    default:
      return [15];
  }
}

/**
 * Whether `words`' last entry is a new best that beat an earlier one -- the
 * moment worth calling out. The first word of the day is trivially the best,
 * and saying so would make the callout meaningless.
 */
export function isNewBest(words: AcceptedWord[]): boolean {
  if (words.length < 2) return false;
  const latest = words[words.length - 1];
  return words.slice(0, -1).every((w) => latest.zipf < w.zipf);
}

/**
 * The value a score roll shows `progress` (0..1) of the way through: an
 * ease-out cubic, so the number races up and then settles on the real score,
 * the way a slot reel slows into place.
 */
export function rollingValue(target: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return target * (1 - (1 - p) ** 3);
}
