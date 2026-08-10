import fragmentData from "../data/fragments.json";
import { daysSinceEpoch } from "./date";

const FRAGMENTS: string[] = fragmentData.fragments;
const EPOCH: string = fragmentData.epoch;

/** Every player gets the same fragment on the same calendar date. */
export function fragmentForDate(dateStr: string): string {
  const dayIndex = daysSinceEpoch(dateStr, EPOCH);
  const i = ((dayIndex % FRAGMENTS.length) + FRAGMENTS.length) % FRAGMENTS.length;
  return FRAGMENTS[i];
}

/**
 * Picks a fragment with no relation to the calendar date -- used only by
 * the dev-only "new fragment" control so a developer can cycle through
 * puzzles for testing without waiting for the real daily rollover.
 */
export function randomFragment(excluding?: string): string {
  if (FRAGMENTS.length <= 1) return FRAGMENTS[0];
  let pick: string;
  do {
    pick = FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)];
  } while (pick === excluding);
  return pick;
}
