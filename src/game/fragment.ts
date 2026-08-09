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
