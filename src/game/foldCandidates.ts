// Every fold a player is about to be able to walk into: the words the next few
// puzzles can reach whose score came from a base form rather than from their own
// frequency. Read by the review page at /fold.
//
// The fold is judged in aggregate everywhere else -- sweep a band, read the
// worst offenders, fix the rule (see the audit skills). That is the right way to
// find a rule that is wrong, and it says nothing about the individual calls a
// correct-looking rule makes. This is the other view: one fold, one row, and a
// person saying yes or no to it. What the yeses and noes are for is in
// api/fold-reviews.ts.
//
// Scoped to the puzzles ahead rather than to the whole dictionary because a
// reviewer's time is worth spending where it changes something. There are tens
// of thousands of folds in the curated list and a few thousand in any one drop,
// and only the ones a player can reach this week are folds anybody will meet
// before the next review pass. Scoped by puzzle, not by clock: the dates are the
// drops the game will serve, which is what "the next couple of days" means to
// everyone who plays it.

import dictionaryWords from "../data/dictionary.json";
import { addDays, todayDateString } from "./date";
import { dropForDate } from "./drop";
import { freeformForDate } from "./mode";
import {
  baseFormSubstitution,
  formatRarityScore,
  isValidWord,
  rarityForZipf,
} from "./dictionary";
import type { Rarity } from "./types";

/**
 * The curated list, read straight rather than through dictionary.ts.
 *
 * dictionary.ts keeps `WORDS` to itself, and deliberately: everything it exports
 * answers a question about *a* word, which is the shape every part of the game
 * needs. This page is the one caller that wants the list itself, and adding an
 * export of 225,000 strings to the module every screen imports, to serve one
 * unlinked curator page, is the worse trade. Same import, same bundled JSON.
 */
const WORDS = dictionaryWords as string[];

/** How many words a reviewer is handed at once. */
export const FOLD_BATCH_SIZE = 25;

/**
 * How many puzzles ahead the review looks.
 *
 * Three rather than a week because the point is the words about to be in play,
 * and because a rejection is not live until somebody exports it and ships the
 * deploy (see scripts/export-fold-rejections.mjs). A verdict reached on a puzzle
 * eight days out will very likely be exported before that puzzle runs, but it is
 * not the thing the page exists to catch.
 */
export const FOLD_REVIEW_DAYS = 3;

/**
 * How far the search for those three puzzles will walk before giving up.
 *
 * A bound rather than a horizon anybody chose: `upcomingFoldDates` skips the
 * days that do not fold, and with the switch set to Freeform *no* day folds --
 * so the walk needs an end. Sixty days is far past any window the page would
 * honestly call "the next few puzzles"; reaching it means the answer is none.
 */
const FOLD_SEARCH_LIMIT = 60;

/** One fold, as the page shows it and as the ledger stores it. */
export interface FoldCandidate {
  /** The word a player would submit. */
  word: string;
  /** The form its score actually came from -- the end of the chain. */
  base: string;
  /** The word's own frequency, before the fold. */
  ownZipf: number;
  /** The base's frequency, which is what the score was computed from. */
  baseZipf: number;
  /** What the word would have scored on its own data, as shown. */
  ownScore: string;
  /** What it scores today, as shown. */
  foldedScore: string;
  /** The rank its own frequency would have earned. */
  ownRarity: Rarity;
  /** The rank it earns folded. */
  foldedRarity: Rarity;
  /** How far the shown score fell, in points -- what the fold cost the player. */
  drop: number;
  /** The first upcoming puzzle that reaches it, and the drop that does. */
  date: string;
  letters: string;
}

/**
 * The puzzles the review covers: the next `days` of them, starting at `from`,
 * that fold at all.
 *
 * The skip is not a detail. A Freeform puzzle scores every word on its own
 * frequency and folds nothing (see `usesFreeformRules` in dictionary.ts), so
 * there is no fold on one of those days for anybody to approve or reject -- and
 * the frozen trial window runs 2026-09-14 to 2026-09-26, which is to say that a
 * literal "today and the two days after" would have spent the whole trial
 * showing an empty page. What a reviewer wants is the next folds a player can
 * actually meet, and those are on the next folding puzzles whenever they fall.
 *
 * From MODE_CHOICE_START the answer also depends on the reader's own Standard /
 * Freeform switch, because that is what decides whether their puzzles fold. A
 * curator reading this page in Freeform gets no dates back, which the page says
 * out loud rather than drawing as an empty queue.
 */
export function upcomingFoldDates(
  days: number = FOLD_REVIEW_DAYS,
  from: string = todayDateString()
): string[] {
  const dates: string[] = [];
  for (let i = 0; i < FOLD_SEARCH_LIMIT && dates.length < days; i += 1) {
    const date = addDays(from, i);
    if (!freeformForDate(date)) dates.push(date);
  }
  return dates;
}

/**
 * Every folded word the given puzzles can reach, worst fold first.
 *
 * "Worst" is the drop in the *shown* score, which is the fold as the player
 * meets it: a word that reads as a 9.9 Legend on its own frequency and scores
 * 4.1 because it is a plural is the review's first question, and a fold that
 * moves the number by a hundredth is its last. Reading the formatted score
 * rather than the raw one keeps the ordering tied to what is on screen, the same
 * way `baseFormRankDrop` does.
 *
 * A word two of these puzzles both reach appears once, under the first of them.
 * The fold is a property of the word, not of the drop that reached it, and
 * reviewing the same pair twice is the one thing a ledger of verdicts makes
 * pointless.
 */
export function foldCandidates(dates: readonly string[]): FoldCandidate[] {
  const seen = new Set<string>();
  const found: FoldCandidate[] = [];

  for (const date of dates) {
    const letters = dropForDate(date);
    const needle = letters.toLowerCase();
    for (const word of WORDS) {
      if (!word.includes(needle)) continue;
      if (seen.has(word)) continue;
      // A word the reviewed rejections already turn away is not a word anybody
      // will score, folded or not -- the same guard `bestWordForDrop` applies
      // for the same reason.
      if (!isValidWord(word, date)) continue;
      const substitution = baseFormSubstitution(word, date);
      if (!substitution) continue;
      seen.add(word);

      const ownScore = formatRarityScore(substitution.ownZipf, date);
      const foldedScore = formatRarityScore(substitution.baseZipf, date);
      found.push({
        word,
        base: substitution.base,
        ownZipf: substitution.ownZipf,
        baseZipf: substitution.baseZipf,
        ownScore,
        foldedScore,
        ownRarity: rarityForZipf(substitution.ownZipf, date),
        foldedRarity: rarityForZipf(substitution.baseZipf, date),
        drop: Math.round((Number(ownScore) - Number(foldedScore)) * 100) / 100,
        date,
        letters,
      });
    }
  }

  // Alphabetical under the drop, so two folds worth the same are in an order
  // that does not move between reads -- a batch that reshuffles itself is a
  // batch you cannot come back to.
  found.sort((a, b) => b.drop - a.drop || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return found;
}

/**
 * One batch: the first `size` folds nobody has dealt with, where `done` is every
 * word already judged or already put in front of this reviewer.
 *
 * A set rather than a page number, and that is the whole of the design. A page
 * number is a position in a list, and this list gets *shorter* as it is
 * answered: judge all twenty-five, ask for page two, and the twenty-five that
 * moved up into those positions are skipped unseen. Taking the front of what is
 * left cannot do that -- every fold is either answered, deliberately passed
 * over, or still ahead.
 */
export function foldBatch(
  candidates: readonly FoldCandidate[],
  done: ReadonlySet<string>,
  size: number = FOLD_BATCH_SIZE
): FoldCandidate[] {
  const batch: FoldCandidate[] = [];
  for (const candidate of candidates) {
    if (done.has(candidate.word)) continue;
    batch.push(candidate);
    if (batch.length === size) break;
  }
  return batch;
}

/** How many folds in the window nobody has judged yet. */
export function unjudgedCount(
  candidates: readonly FoldCandidate[],
  judged: ReadonlySet<string>
): number {
  let count = 0;
  for (const candidate of candidates) if (!judged.has(candidate.word)) count += 1;
  return count;
}
