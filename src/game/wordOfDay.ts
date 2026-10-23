/**
 * The word of the day experiment: does the word under a finished puzzle's drop
 * -- the "Word of the day" button, or the word and its definition once the
 * retry is spent (see components/DropDisplay) -- bring players back?
 *
 * One 50/50 split, drawn the first time a player finishes a puzzle (the first
 * time the section would appear), and kept for good. `shown` sees it as
 * before; `hidden` sees nothing under the drop. Drawing at that moment rather
 * than on arrival means everyone in the test reached the thing being tested,
 * so the arms differ only in what they saw.
 *
 * The draw is reported once, as `word_of_day_assigned`, which
 * `analytics_v2_word_of_day` joins every later word, share and return to; the
 * result is read on /analyticsV2.
 */

export type WordOfDayVariant = "shown" | "hidden";

const ASSIGNMENT_KEY = "ick:word-of-day";

function isVariant(value: unknown): value is WordOfDayVariant {
  return value === "shown" || value === "hidden";
}

/**
 * The player's arm, if they have one already. Never assigns. Undefined when
 * storage cannot be read at all, which keeps that browser out of the test.
 */
export function currentWordOfDayVariant(): WordOfDayVariant | null | undefined {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return undefined;
  }
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in an experiment.
 */
export function assignWordOfDayVariant(
  random: () => number = Math.random
): { variant: WordOfDayVariant; fresh: boolean } | null {
  const existing = currentWordOfDayVariant();
  if (existing === undefined) return null;
  if (existing) return { variant: existing, fresh: false };
  const variant: WordOfDayVariant = random() < 0.5 ? "shown" : "hidden";
  try {
    localStorage.setItem(ASSIGNMENT_KEY, variant);
  } catch {
    return null;
  }
  return { variant, fresh: true };
}

/**
 * An arm forced with `?word-of-day=hidden` (or `=shown`), for trying either
 * out without waiting on a coin flip. Never stored or reported.
 */
export function forcedWordOfDayVariant(search: string = window.location.search): WordOfDayVariant | null {
  const value = new URLSearchParams(search).get("word-of-day");
  return isVariant(value) ? value : null;
}
