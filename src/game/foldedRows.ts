// The rows of /folded-live: what one puzzle's players banked that Standard
// scored as a common form. See components/FoldedLivePage.tsx.

import { corpusEntry } from "./corpus";
import { foldTrace, isDictionaryWord, unattestedZipf } from "./dictionary";
import { foldRuleId } from "./foldRules";
import type { FoundWord } from "./leaderboard";

/** One folded word on the puzzle, as the page shows it. */
export interface FoldedRow {
  word: string;
  /** The common form Standard scored it as. */
  base: string;
  ownZipf: number;
  baseZipf: number;
  /** How many players banked it. */
  finders: number;
  /**
   * The `foldRuleset` id of the rule the fold is judged on, its loosest link.
   * Absent on a rejected word the feed no longer carries, which is not traced.
   */
  rule?: string;
}

/**
 * The words players banked on `date` that Standard scored as a common form.
 *
 * Read off the finds feed rather than off the drop's whole reach: the point of
 * this page is the folds people actually met, and a live rejection only changes
 * anything for someone holding the word. Priced as Standard whatever the
 * reader's own switch says, because Freeform never folds. Biggest drop first.
 */
export function foldedRows(date: string, finds: readonly FoundWord[]): FoldedRow[] {
  const rows: FoldedRow[] = [];
  for (const find of finds) {
    if (find.standard === false) continue;
    const word = find.word.toLowerCase();
    // A word the curated list lacks is traced from the corpus's own number, as
    // the game scored it; one neither list knows came from Merriam-Webster and
    // was never folded.
    let ownZipf: number | undefined;
    if (!isDictionaryWord(word)) {
      const entry = corpusEntry(word);
      if (!entry) continue;
      ownZipf = entry.zipf ?? unattestedZipf();
    }
    const trace = foldTrace(word, date, ownZipf, "standard");
    if (!trace) continue;
    rows.push({
      word,
      base: trace.base,
      ownZipf: trace.ownZipf,
      baseZipf: trace.baseZipf,
      finders: find.finders,
      rule: foldRuleId(trace.path),
    });
  }
  return rows.sort((a, b) => b.baseZipf - b.ownZipf - (a.baseZipf - a.ownZipf));
}
