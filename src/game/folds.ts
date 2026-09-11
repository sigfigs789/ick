import dictionaryWords from "../data/dictionary.json";
import {
  baseFormSubstitution,
  formatRarityScore,
  isValidWord,
  rarityForZipf,
} from "./dictionary";
import type { Rarity } from "./types";

const WORDS: readonly string[] = dictionaryWords as string[];

/**
 * One word that scores as something else.
 *
 * The fold is the least visible rule in the game and the one that surprises
 * players most: `outwilled` looks like a find and scores as `will`. The game
 * says so a word at a time, under the badge it just explained away (see
 * baseFormRankDrop) -- this is the same fact for the whole dictionary at once,
 * which is the form it takes when somebody wants to *check* the rule rather
 * than be told about one result of it.
 *
 * Both scores are kept as Zipfs rather than as numbers already formatted: a
 * badge wants the rarity and the frequency it came from, and the shown score is
 * a function of both (see RarityBadge). `drop` is the one derived value, and it
 * is derived from the *shown* scores, because it exists to be sorted on and a
 * reader sorting by "biggest drop" is ordering what they can see.
 */
export interface FoldedWord {
  /** The word as it is spelled in the dictionary. */
  word: string;
  /** The more common form its score actually came from. */
  base: string;
  /** The word's own frequency, before the fold. */
  ownZipf: number;
  /** The common form's frequency -- what the score is computed from. */
  baseZipf: number;
  /** The rank the word would have carried on its own data. */
  ownRarity: Rarity;
  /** The rank it carries after the fold. */
  baseRarity: Rarity;
  /** Shown score before the fold minus shown score after it, in points. */
  drop: number;
}

/** How many words a full scan walks -- the whole dictionary. */
export const FOLD_SCAN_TOTAL = WORDS.length;

/** The shown score for a Zipf, as a number, under the current scoring system. */
function shownScore(zipf: number): number {
  return Number(formatRarityScore(zipf));
}

/**
 * Scan `count` words starting at `from`, appending every fold found to `into`.
 * Returns the index to resume at, which is FOLD_SCAN_TOTAL once the dictionary
 * is exhausted.
 *
 * Resumable rather than one pass over 225,000 words, because the whole scan is
 * over a second of work and the page that wants it is a page somebody just
 * opened: run whole, it would hold the main thread through the first frame and
 * the reader would meet a blank screen that does not scroll. The caller owns
 * the scheduling (see FoldedWordsPage); this only knows how to stop and be
 * picked up again.
 *
 * Rejected words are skipped. A fold on a word nobody can play is a rule
 * applied to nothing, and this list is read as "what would happen if I found
 * it" -- the same reason `bestWordForDrop` filters them out of the ceiling it
 * shows.
 */
export function scanFolds(from: number, count: number, into: FoldedWord[]): number {
  const end = Math.min(from + count, WORDS.length);
  for (let i = from; i < end; i++) {
    const word = WORDS[i];
    if (!isValidWord(word)) continue;
    const substitution = baseFormSubstitution(word);
    if (!substitution) continue;
    const { base, ownZipf, baseZipf } = substitution;
    into.push({
      word,
      base,
      ownZipf,
      baseZipf,
      ownRarity: rarityForZipf(ownZipf),
      baseRarity: rarityForZipf(baseZipf),
      drop: Math.round((shownScore(ownZipf) - shownScore(baseZipf)) * 100) / 100,
    });
  }
  return end;
}

/**
 * The completed scan, kept for the life of the tab.
 *
 * The dictionary and the scoring rules are both baked into the bundle, so the
 * answer cannot change under a reader -- and a page they leave and come back to
 * should not spend the second again. Module scope rather than component state
 * for exactly that: the page unmounts every time the player goes back to the
 * puzzle.
 */
let cached: readonly FoldedWord[] | null = null;

/** The scan if one has already finished in this tab, otherwise null. */
export function cachedFolds(): readonly FoldedWord[] | null {
  return cached;
}

/** Remember a finished scan for the next visit. */
export function cacheFolds(folds: readonly FoldedWord[]): void {
  cached = folds;
}

/** Forget the cached scan. Tests only -- nothing in the app invalidates it. */
export function clearFoldCache(): void {
  cached = null;
}

/** How the list can be ordered. */
export type FoldSort = "drop" | "alphabetical";

/**
 * Order the folds.
 *
 * Biggest drop first by default: the list is long enough that its first screen
 * is the only one most readers see, and what a reader came to check is the folds
 * that cost the most -- an alphabetical list opens on `aaronic` and says nothing
 * about the rule. Ties break alphabetically so the order is total, and a list
 * rebuilt from the same data is the same list.
 */
export function sortFolds(
  folds: readonly FoldedWord[],
  sort: FoldSort,
): readonly FoldedWord[] {
  const sorted = [...folds];
  if (sort === "alphabetical") {
    sorted.sort((a, b) => a.word.localeCompare(b.word));
    return sorted;
  }
  sorted.sort((a, b) => b.drop - a.drop || a.word.localeCompare(b.word));
  return sorted;
}

/**
 * The folds matching a query, on either side of the arrow.
 *
 * Both sides, because there are two questions a reader brings here and they are
 * asked with the same box: "why did *my* word score like that" is a search for a
 * word, and "what all folds onto `will`" is a search for a common form. A
 * substring match rather than a prefix, so a suffix -- the thing most folds
 * actually turn on -- is searchable too.
 */
export function filterFolds(
  folds: readonly FoldedWord[],
  query: string,
): readonly FoldedWord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return folds;
  return folds.filter(
    (fold) => fold.word.includes(needle) || fold.base.includes(needle),
  );
}
