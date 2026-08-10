import dropData from "../data/drops.json";
import { daysSinceEpoch } from "./date";

const DROPS: string[] = dropData.drops;
const EPOCH: string = dropData.epoch;

/** Every player gets the same drop on the same calendar date. */
export function dropForDate(dateStr: string): string {
  const dayIndex = daysSinceEpoch(dateStr, EPOCH);
  const i = ((dayIndex % DROPS.length) + DROPS.length) % DROPS.length;
  return DROPS[i];
}
