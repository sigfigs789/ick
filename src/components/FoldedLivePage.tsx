import { useCallback, useEffect, useRef, useState } from "react";
import { PuzzleNav } from "./PuzzleNav";
import { addDays, todayDateString } from "../game/date";
import { loadCorpus } from "../game/corpus";
import { formatRarityScore, rarityForZipf, usesFreeformRules } from "../game/dictionary";
import { foldedRows, type FoldedRow } from "../game/foldedRows";
import { feedFloor, fetchFoundWords } from "../game/leaderboard";
import {
  fetchLiveFoldRejections,
  setLiveFoldRejection,
} from "../game/liveFoldRejections";
import { puzzleNumber } from "../game/share";
import { navigate } from "../routes";

type LoadState = "loading" | "ready" | "error";

/**
 * The words folded on one puzzle, at /folded-live: step through the puzzles,
 * and reject a fold to have that word score as itself on that puzzle.
 *
 * Live, unlike /fold. A rejection here is written to the database and every
 * player who opens the puzzle has their word repriced and is told why (see
 * game/liveFoldRejections.ts and components/FoldedLiveNotice.tsx). Pressing it
 * again takes the rejection back. Scoped to the puzzle on screen and nothing
 * else: the reviewed, shipped route for a fold that is wrong everywhere is
 * still /fold.
 *
 * Unkeyed and unlinked, like /analytics: it opens without a password, and is
 * listed on /help.
 */
export function FoldedLivePage() {
  const today = useRef(todayDateString()).current;
  const floor = feedFloor();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<FoldedRow[]>([]);
  /** Rejected words on this puzzle, word -> the base it had folded to. */
  const [rejected, setRejected] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<LoadState>("loading");
  const [saveFailed, setSaveFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const freeformOnly = usesFreeformRules(date, "standard");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSaveFailed(false);
    setRows([]);
    setRejected(new Map());
    if (freeformOnly) {
      setState("ready");
      return;
    }
    // The corpus first: since the corpus-era cutover the fold prices against
    // its lexicon, and tracing before it lands would report that nothing folds.
    Promise.all([
      loadCorpus(),
      fetchFoundWords(date, { fresh: true }),
      fetchLiveFoldRejections(date, { fresh: true }),
    ])
      .then(([, finds, rejections]) => {
        if (cancelled) return;
        const traced = foldedRows(date, finds);
        // A rejected word the feed no longer carries still gets a row, so a
        // rejection can always be taken back from here.
        const shown = new Set(traced.map((row) => row.word));
        for (const r of rejections) {
          if (shown.has(r.word)) continue;
          traced.push({ word: r.word, base: r.base, ownZipf: NaN, baseZipf: NaN, finders: 0 });
        }
        setRows(traced);
        setRejected(new Map(rejections.map((r) => [r.word, r.base])));
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [date, freeformOnly, reload]);

  /**
   * Reject a fold, or take the rejection back. The row moves on the click and
   * the write follows; a failure puts it back and says so.
   */
  const toggle = useCallback(
    (row: FoldedRow) => {
      const was = rejected.has(row.word);
      const want = !was;
      const apply = (on: boolean) =>
        setRejected((all) => {
          const next = new Map(all);
          if (on) next.set(row.word, row.base);
          else next.delete(row.word);
          return next;
        });
      setSaveFailed(false);
      apply(want);
      setLiveFoldRejection(date, { word: row.word, base: row.base }, want)
        .then((stored) => {
          if (live.current) apply(stored);
        })
        .catch(() => {
          if (!live.current) return;
          apply(was);
          setSaveFailed(true);
        });
    },
    [date, rejected]
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Words folded
            {state === "ready" && rows.length > 0 && (
              <span className="review__count">{rows.length}</span>
            )}
          </h1>
          <p className="page-head__note">
            Words players banked in Standard that scored as a common form. Reject a fold and
            that word scores as is on this puzzle — players who open it are told.
          </p>
        </div>
        <button
          type="button"
          className="app__icon-button leaderboard-page__refresh"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh"
          title="Refresh"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <PuzzleNav
        date={date}
        puzzleNumber={puzzleNumber(date)}
        canGoToPrevious={date > floor}
        canGoToNext={date < today}
        onPrevious={() => setDate((d) => (d > floor ? addDays(d, -1) : d))}
        onNext={() => setDate((d) => (d < today ? addDays(d, 1) : d))}
      />

      {state === "loading" && <p className="review__status">Loading…</p>}
      {state === "error" && (
        <p className="review__status">
          Couldn{"’"}t load this puzzle.{" "}
          <button
            type="button"
            className="review__retry"
            onClick={() => setReload((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      {state === "ready" && rows.length === 0 && (
        <p className="review__status">
          {freeformOnly
            ? "This puzzle was Freeform for everyone — nothing folded."
            : "No banked word on this puzzle was scored as a common form."}
        </p>
      )}
      {saveFailed && (
        <p className="review__failed" role="status">
          Couldn{"’"}t save that — it{"’"}s been put back.
        </p>
      )}

      {state === "ready" && rows.length > 0 && (
        <ul className="review__list fold__list">
          {rows.map((row) => {
            const isRejected = rejected.has(row.word);
            const priced = Number.isFinite(row.ownZipf) && Number.isFinite(row.baseZipf);
            return (
              <li
                key={row.word}
                className={`review__item fold__item folded-live__item${isRejected ? " folded-live__item--rejected" : ""}`}
              >
                <div className="review__body">
                  <p className="fold__fold">
                    <span className="fold__word">{row.word}</span>
                    <span className="fold__arrow" aria-hidden="true">
                      →
                    </span>
                    <span className={`fold__base${isRejected ? " folded-live__struck" : ""}`}>
                      {row.base}
                    </span>
                  </p>
                  {priced && (
                    <p className="fold__scores">
                      <span className="fold__score">
                        as is {formatRarityScore(row.ownZipf, date)}{" "}
                        {rarityForZipf(row.ownZipf, date, "standard")}
                      </span>
                      <span className="fold__score">
                        · folded {formatRarityScore(row.baseZipf, date)}{" "}
                        {rarityForZipf(row.baseZipf, date, "standard")}
                      </span>
                    </p>
                  )}
                  <p className="review__meta">
                    {row.finders > 0 && (
                      <span>
                        {row.finders} {row.finders === 1 ? "player" : "players"}
                      </span>
                    )}
                    {isRejected && <span>Scoring as is</span>}
                  </p>
                </div>
                <button
                  type="button"
                  className={`folded-live__reject${isRejected ? " folded-live__reject--on" : ""}`}
                  aria-pressed={isRejected}
                  onClick={() => toggle(row)}
                >
                  {isRejected ? "Undo" : "Reject"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="leaderboard-page__back"
        onClick={() => navigate("game")}
      >
        Back to today{"’"}s puzzle
      </button>
    </main>
  );
}
