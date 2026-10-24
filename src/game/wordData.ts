import { scoringLoaded, scoringReady } from "./dictionary";
import { rejectionMetadataLoaded, rejectionMetadataReady } from "./submit";

/*
 * The word data fetched after the app starts, as one wait.
 *
 * Two kinds of file arrive late: the rejection metadata (submit.ts), which
 * decides which reason a refused word is given, and the deferred scoring data
 * (dictionary.ts), which decides what an accepted word scores. Anything that
 * judges or scores a word waits on both, so it never has to know which file
 * moves what.
 */

/** Resolves once every deferred word-data file `date`'s puzzle needs is in. */
export function wordDataReady(date?: string): Promise<void> {
  return Promise.all([rejectionMetadataReady, scoringReady(date)]).then(() => undefined);
}

/** Whether `wordDataReady(date)` has resolved. */
export function wordDataLoaded(date?: string): boolean {
  return rejectionMetadataLoaded() && scoringLoaded(date);
}
