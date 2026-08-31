import dropData from "../data/drops.json";
import { daysSinceEpoch } from "./date";

const DROPS: string[] = dropData.drops;
const EPOCH: string = dropData.epoch;

/**
 * The day the game dropped its first puzzle.
 *
 * Exported because it is the floor of everything the game can be asked to look
 * back at: there is no puzzle before it, so there is no score, no find and no
 * board window on the far side of it. Read from the same data the drops
 * themselves come from, so a game that ever moves its epoch moves this with it.
 */
export const FIRST_PUZZLE = EPOCH;

/** Every player gets the same drop on the same calendar date. */
export function dropForDate(dateStr: string): string {
  const dayIndex = daysSinceEpoch(dateStr, EPOCH);
  const i = ((dayIndex % DROPS.length) + DROPS.length) % DROPS.length;
  return DROPS[i];
}
