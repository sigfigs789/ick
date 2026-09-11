import { useEffect, useMemo, useState } from "react";
import { RarityBadge } from "./RarityBadge";
import {
  cacheFolds,
  cachedFolds,
  filterFolds,
  FOLD_SCAN_TOTAL,
  scanFolds,
  sortFolds,
  type FoldedWord,
  type FoldSort,
} from "../game/folds";
import { navigate } from "../routes";

/** How many dictionary words the scan walks between checks of its clock. */
const SCAN_CHUNK = 2000;

/**
 * How long one pass of the scan may hold the thread, in milliseconds.
 *
 * Under a frame, so a reader typing into the search box while the list builds is
 * never waiting more than one of these for their keystroke. The scan is about a
 * second of work in total, so this is what turns it into roughly a hundred short
 * pauses rather than one long freeze.
 */
const PASS_BUDGET_MS = 12;

/**
 * How often the rows on screen are allowed to catch up with the scan, in
 * milliseconds.
 *
 * Separate from the pass budget above, and the more important of the two: every
 * update re-sorts everything found so far, which by the end is a hundred
 * thousand rows and costs more than the scanning does. Repainting a few times a
 * second is all a progress line and a list nobody is reading yet can use, and it
 * keeps that cost to a dozen sorts rather than a hundred.
 */
const PAINT_EVERY_MS = 150;

/** How many rows are on screen before the reader asks for more. */
const PAGE_SIZE = 100;

/**
 * Every word that scores as a more common form, at /folded-words.
 *
 * Unlisted, and deliberately: nothing in the app links here. The route exists
 * to be typed, because this is the fold rule written out for somebody checking
 * it -- and a page of 115,000 rows saying what the game scores a word as is an
 * answer key in front of a player who only wanted to know why one word of
 * theirs came out low. That question is already answered where it is asked, on
 * the word itself in the guess log (see baseFormRankDrop).
 *
 * The fold is the rule players trip over: a word can be a genuinely rare find
 * and still score as something ordinary, because the score follows the most
 * common word in its family (see `chainedBase` in game/dictionary.ts).
 * `outwilled` is scored as `will`; `onenesses` as `one`. The game already says
 * so when it happens, under the badge that would otherwise look broken -- but
 * one word at a time, only for the words a player happened to find, and only
 * when the fold cost a rank (see baseFormRankDrop).
 *
 * This is the rest of it: all 115,000-odd folds, each with the word played, the
 * common form it lands on, and the two scores. What it answers is the question
 * a single note raises and cannot settle -- is this a rule, or is this a bug? --
 * and the only honest way to answer it is the whole table, searchable.
 *
 * Built in the browser rather than shipped as data. The fold is not a list, it
 * is the scoring code, and a precomputed table is a second copy of it that can
 * quietly disagree with the one the game scores by. Running the real function
 * over the real dictionary costs about a second, which is why the scan below
 * gives the thread back between passes.
 */
export function FoldedWordsPage() {
  /**
   * The scan: the folds so far, and where in the dictionary it has reached.
   *
   * Both in state rather than a ref, because both are on screen -- the rows are
   * rendered as they arrive, and the position is the progress line above them. A
   * finished scan from an earlier visit skips straight to the end (see
   * cachedFolds).
   */
  const done = cachedFolds();
  const [folds, setFolds] = useState<readonly FoldedWord[]>(() => done ?? []);
  const [scanned, setScanned] = useState(done ? FOLD_SCAN_TOTAL : 0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FoldSort>("drop");
  /** How many rows the reader has asked for, reset by any change to the list. */
  const [shown, setShown] = useState(PAGE_SIZE);

  /**
   * Walk the dictionary a slice of a frame at a time until it is done.
   *
   * Run as one loop this is a second of work landing inside the first frame:
   * the reader would open a page that is blank, unscrollable and unresponsive,
   * and then finished. Broken up, the first rows are on screen almost
   * immediately and the page answers a keystroke while the rest arrive
   * underneath.
   */
  useEffect(() => {
    if (cachedFolds()) return;
    const collected: FoldedWord[] = [];
    let at = 0;
    let cancelled = false;
    let painted = 0;

    /**
     * The yield between passes.
     *
     * A message to ourselves rather than `setTimeout(…, 0)`, because a tab in
     * the background clamps timers to about a second: a reader who opened this
     * page and switched away would come back to a scan that had made a hundred
     * passes in a hundred seconds and was still going. A posted message is not
     * clamped, so a backgrounded scan finishes at the speed it would have
     * finished at anyway.
     */
    const channel = new MessageChannel();

    channel.port1.onmessage = () => {
      if (cancelled) return;
      const started = performance.now();
      do {
        at = scanFolds(at, SCAN_CHUNK, collected);
      } while (at < FOLD_SCAN_TOTAL && performance.now() - started < PASS_BUDGET_MS);

      const finished = at >= FOLD_SCAN_TOTAL;
      if (finished || performance.now() - painted >= PAINT_EVERY_MS) {
        painted = performance.now();
        // A fresh slice so React sees a new value -- the scan appends to the one
        // array, so a pass costs what it scanned rather than a copy of
        // everything found so far.
        setFolds(collected.slice());
        setScanned(at);
      }
      if (!finished) {
        channel.port2.postMessage(null);
        return;
      }
      // Only a scan that reached the end is worth keeping: a partial one cached
      // would be served to the next visit as if it were the whole table.
      cacheFolds(collected);
    };

    channel.port2.postMessage(null);
    return () => {
      // A reader who opens this page and goes straight back to the puzzle
      // unmounts it mid-scan; without this the chain would run to the end of the
      // dictionary setting state on a dead component.
      cancelled = true;
      channel.port1.close();
      channel.port2.close();
    };
  }, []);

  /**
   * The list as asked for: filtered, then ordered.
   *
   * Memoised because both steps touch every row and the scan re-renders this
   * page a few dozen times on the way in -- without it, each of those passes
   * would re-sort everything found so far.
   */
  const listed = useMemo(
    () => sortFolds(filterFolds(folds, query), sort),
    [folds, query, sort],
  );

  // A new question gets the first page of its answer, not the reader's scroll
  // position in the last one.
  useEffect(() => setShown(PAGE_SIZE), [query, sort]);

  const scanning = scanned < FOLD_SCAN_TOTAL;
  const rows = listed.slice(0, shown);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Folded words</h1>
          <p className="page-head__note">
            Words whose score comes from a more common form of the same word.
            The rarer score is what the word's own frequency would have earned;
            the one beside it is what the word actually scores.
          </p>
        </div>
      </div>

      <div className="folds__controls">
        <label className="sr-only" htmlFor="folds-search">
          Search folded words
        </label>
        <input
          id="folds-search"
          className="folds__search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a word or a common form"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <div className="folds__sort" role="group" aria-label="Order">
          {/* Two orders, because there are two ways to read this table: down it,
              worst first, to see what the rule does, or straight to one word to
              see what it does to that. */}
          {(
            [
              ["drop", "Biggest drop"],
              ["alphabetical", "A–Z"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`folds__sort-button${
                sort === value ? " folds__sort-button--current" : ""
              }`}
              onClick={() => setSort(value)}
              aria-pressed={sort === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* One line saying what is on screen, and while the scan is running, that
          it is still arriving -- a count that climbs under a reader who was told
          nothing is a page that looks like it cannot make up its mind. */}
      <p className="folds__count" aria-live="polite">
        {listed.length.toLocaleString()}{" "}
        {listed.length === 1 ? "word" : "words"}
        {query.trim() && " matching"}
        {scanning
          ? ` — still reading the dictionary (${Math.round(
              (scanned / FOLD_SCAN_TOTAL) * 100,
            )}%)`
          : ""}
      </p>

      {listed.length === 0 && !scanning ? (
        <p className="leaderboard__status">
          No folded word matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="folds__list">
          {rows.map((fold) => (
            <li key={fold.word} className="folds__item">
              <span className="folds__pair">
                <span className="folds__word">{fold.word}</span>
                <span className="folds__arrow" aria-hidden="true">
                  →
                </span>
                {/* "scored as" is carried in the accessible text rather than
                    the arrow, which is decoration: a reader hearing this row
                    needs the relation, not the glyph. */}
                <span className="sr-only">scored as</span>
                <span className="folds__base">{fold.base}</span>
              </span>
              <span className="folds__scores">
                <span className="folds__score folds__score--own">
                  <span className="sr-only">On its own: </span>
                  <RarityBadge rarity={fold.ownRarity} zipf={fold.ownZipf} />
                </span>
                <span className="folds__arrow" aria-hidden="true">
                  →
                </span>
                <span className="folds__score">
                  <span className="sr-only">Folded: </span>
                  <RarityBadge rarity={fold.baseRarity} zipf={fold.baseZipf} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {shown < listed.length && (
        <button
          type="button"
          className="folds__more"
          onClick={() => setShown((was) => was + PAGE_SIZE)}
        >
          Show {Math.min(PAGE_SIZE, listed.length - shown)} more
        </button>
      )}

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today's puzzle
      </button>
    </main>
  );
}
