import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewPage } from "./ReviewPage";
import { formatDateLabel } from "../game/date";
import { loadCorpus } from "../game/corpus";
import {
  FOLD_BATCH_SIZE,
  foldBatch,
  foldCandidates,
  unjudgedCount,
  upcomingFoldDates,
  type FoldCandidate,
} from "../game/foldCandidates";
import {
  fetchFoldReviews,
  hasReviewKey,
  setFoldReview,
  type FoldVerdict,
} from "../game/foldReview";

/**
 * The fold review at /fold: one fold per row, approved or rejected by hand.
 *
 * Every other page in this app is for a player. This one is for whoever owns the
 * scoring, and it exists because the fold -- the rule that scores "timelinesses"
 * as "time" -- is judged nowhere else one call at a time. It is judged in
 * aggregate: sweep a band, read the worst offenders, fix the rule (see the audit
 * skills). That finds a rule that is wrong and says nothing about the thousands
 * of individual calls a right-looking rule makes, which is what a player
 * actually meets.
 *
 * So: the folds the next few puzzles can reach, worst first, twenty-five at a
 * time, with the word, the form its score came from, and what the fold cost it.
 * Two controls rather than the three-state cycle the other review pages use --
 * approve and reject are the question, and a cycle that passes through "clear"
 * on the way from one to the other is a control built for tracking what has been
 * read rather than for deciding.
 *
 * What the answers are for, in order of how soon they matter:
 *
 *   * A rejection becomes an entry in `src/data/fold-exemptions.json`, which is
 *     what stops the fold in the game -- by way of a script and a deploy, never
 *     live. Scoring is dated, deterministic and offline, and a puzzle whose
 *     scores depend on a table somebody can edit mid-day is a puzzle that cannot
 *     be replayed. See scripts/export-fold-rejections.mjs.
 *   * Both answers together are a labelled set: the judgement a model would have
 *     to learn, written down. A file of nothing but rejections says what a bad
 *     fold looks like and nothing at all about a good one, which is why an
 *     approval is stored rather than being left as the absence of a rejection.
 *
 * Unlinked, and keyed in both directions -- see api/fold-reviews.ts for why this
 * one fails closed where the feedback page does not.
 */
export function FoldReviewPage() {
  const keyed = hasReviewKey();

  const dates = useMemo(() => upcomingFoldDates(), []);
  /** The folds those puzzles reach, or null while they are being worked out. */
  const [candidates, setCandidates] = useState<readonly FoldCandidate[] | null>(null);
  const [judged, setJudged] = useState<Record<string, FoldVerdict>>({});
  /**
   * The words that were already judged when this batch was drawn.
   *
   * Frozen deliberately, rather than being read off `judged` as it changes. The
   * batch is "the next twenty-five unjudged folds", and recomputing it on every
   * answer would pull a new row up from underneath the cursor each time --
   * leaving the reviewer chasing the list down the page. So answering a fold
   * marks it in place, and the batch moves only when somebody asks it to.
   */
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(new Set());
  /**
   * The folds this reviewer has been shown and pressed past without answering.
   *
   * Kept beside `frozen` rather than merged into it because the two are
   * different facts with different lifetimes: a judged word is gone from the
   * queue for everybody, and a passed one is gone only for this sitting, and
   * comes back on the next read.
   */
  const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());
  const [ledgerRead, setLedgerRead] = useState(false);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /**
   * Work out the folds, once.
   *
   * Behind the corpus, because since the corpus-era cutover the fold prices
   * against the corpus lexicon and not the curated list: run before the 3.6MB
   * download lands and this page would report that nothing folds, which is both
   * wrong and quiet. The scan itself is a third of a second over three drops and
   * 225,000 words, so it is handed to a timeout rather than run inside the
   * effect -- the "Loading…" the reader is owed has to paint first.
   */
  useEffect(() => {
    if (!keyed || dates.length === 0) return;
    let cancelled = false;
    loadCorpus().then(() => {
      if (cancelled) return;
      window.setTimeout(() => {
        if (cancelled) return;
        setCandidates(foldCandidates(dates));
      }, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [keyed, dates]);

  const readLedger = useCallback(() => {
    if (!keyed) return;
    fetchFoldReviews()
      .then((reviews) => {
        if (!live.current) return;
        const stored: Record<string, FoldVerdict> = {};
        for (const review of reviews) stored[review.word] = review.verdict;
        setJudged(stored);
        // The snapshot the batch is cut from -- see `frozen` above. A re-read is
        // a fresh start on the queue, so the folds passed over come back with it.
        setFrozen(new Set(Object.keys(stored)));
        setPassed(new Set());
        setLedgerRead(true);
        setFailed((was) => (was === "load" ? null : was));
      })
      .catch(() => {
        if (!live.current) return;
        setFailed("load");
      });
  }, [keyed]);

  useEffect(() => {
    readLedger();
  }, [readLedger]);

  /**
   * Answer one fold, or take the answer back.
   *
   * The click moves the control and the write follows, the same bargain the
   * other review pages strike: waiting for the round trip before drawing
   * anything would make every verdict feel like a page load, on a page whose
   * whole job is to be answered quickly. A failure puts the answer back and says
   * so -- a tick standing over a fold nothing was saved for would make the
   * ledger a record of what was clicked rather than of what was decided.
   *
   * Clicking the answer a fold already has takes it back, which is what makes
   * two buttons enough: approve, reject, and undo either by pressing it again.
   */
  const answer = useCallback(
    (candidate: FoldCandidate, verdict: Exclude<FoldVerdict, null>) => {
      const was = judged[candidate.word] ?? null;
      const wanted = was === verdict ? null : verdict;
      setFailed(null);
      setJudged((all) => ({ ...all, [candidate.word]: wanted }));
      setFoldReview(
        {
          word: candidate.word,
          base: candidate.base,
          ownZipf: candidate.ownZipf,
          baseZipf: candidate.baseZipf,
          date: candidate.date,
        },
        wanted
      )
        // Drawn from the answer rather than left on the guess. They agree in
        // every ordinary case; when they do not, the database is right.
        .then((stored) => {
          if (!live.current) return;
          setJudged((all) => ({ ...all, [candidate.word]: stored }));
        })
        .catch(() => {
          if (!live.current) return;
          setJudged((all) => ({ ...all, [candidate.word]: was }));
          setFailed("save");
        });
    },
    [judged]
  );

  const rows = useMemo(() => {
    if (!candidates) return [];
    const done = new Set([...frozen, ...passed]);
    return foldBatch(candidates, done);
  }, [candidates, frozen, passed]);
  const remaining = candidates ? unjudgedCount(candidates, frozen) : 0;
  const ready = candidates !== null && ledgerRead;

  /**
   * Hand over a fresh twenty-five.
   *
   * The rows answered in this batch are now in the ledger and leave the queue on
   * their own; the ones left blank were looked at and declined, so they are put
   * aside for this sitting. Both together are what "next" means -- twenty-five
   * folds nobody has dealt with, rather than the next twenty-five positions in a
   * list that just got shorter.
   */
  const nextBatch = () => {
    setFrozen(new Set(Object.keys(judged).filter((word) => judged[word])));
    setPassed((was) => {
      const next = new Set(was);
      for (const row of rows) if (!judged[row.word]) next.add(row.word);
      return next;
    });
  };

  if (!keyed) {
    return (
      <ReviewPage
        title="Fold review"
        note="Approve or reject the folds the next few puzzles can reach."
        count={0}
        state="ready"
        refreshing={false}
        onRefresh={() => {}}
        onRetry={() => {}}
        empty="This page needs a review key. Open it with ?key= on the URL."
      >
        {null}
      </ReviewPage>
    );
  }

  if (dates.length === 0) {
    return (
      <ReviewPage
        title="Fold review"
        note="Approve or reject the folds the next few puzzles can reach."
        count={0}
        state="ready"
        refreshing={false}
        onRefresh={() => {}}
        onRetry={() => {}}
        // Freeform scores every word on its own frequency, so there is no fold
        // on any puzzle ahead to judge. Said rather than drawn as an empty
        // queue, which would read as "no folds left" -- the opposite of true.
        empty="No folding puzzles ahead — Freeform scores every word on its own frequency. Switch to Standard to review folds."
      >
        {null}
      </ReviewPage>
    );
  }

  return (
    <ReviewPage
      title="Fold review"
      note={`Folds ${dates.map(formatDateLabel).join(", ")} can reach — biggest drop first, ${FOLD_BATCH_SIZE} at a time.`}
      count={remaining}
      state={failed === "load" ? "error" : ready ? "ready" : "loading"}
      refreshing={false}
      onRefresh={readLedger}
      onRetry={() => {
        setFailed(null);
        readLedger();
      }}
      empty="Every fold in these puzzles has been judged."
      markFailed={failed === "save"}
    >
      {/* The end of the window, reached by pressing Next past the last batch.
          Said here rather than through the shell's empty line, which is for a
          list with nothing in it at all -- and said above the button, which
          still works and walks back. */}
      {rows.length === 0 && (
        <p className="review__status">
          That{"’"}s the last batch — {remaining} unjudged{" "}
          {remaining === 1 ? "fold" : "folds"} behind it.
        </p>
      )}
      <ul className="review__list fold__list">
        {rows.map((candidate) => {
          const verdict = judged[candidate.word] ?? null;
          return (
            <li
              key={candidate.word}
              className={`review__item fold__item fold__item--${verdict ?? "unjudged"}`}
            >
              <div className="review__body">
                <p className="fold__fold">
                  <span className="fold__word">{candidate.word}</span>
                  <span className="fold__arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="fold__base">{candidate.base}</span>
                </p>
                <p className="fold__scores">
                  <span className="fold__score">
                    {candidate.ownScore} {candidate.ownRarity}
                  </span>
                  <span className="fold__arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="fold__score">
                    {candidate.foldedScore} {candidate.foldedRarity}
                  </span>
                  {/* The cost of the fold, which is the row's actual question.
                      Minus signed, because every fold is a cap and the number
                      can only ever come down. */}
                  <span className="fold__drop">−{candidate.drop.toFixed(2)}</span>
                </p>
                <p className="review__meta">
                  <span>{formatDateLabel(candidate.date)}</span>
                  <span>{candidate.letters}</span>
                  <span>
                    Zipf {candidate.ownZipf.toFixed(2)} → {candidate.baseZipf.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="fold__verdict">
                <button
                  type="button"
                  className={`fold__button fold__button--approve${verdict === "approved" ? " fold__button--on" : ""}`}
                  aria-pressed={verdict === "approved"}
                  aria-label={`Approve folding ${candidate.word} to ${candidate.base}`}
                  onClick={() => answer(candidate, "approved")}
                >
                  <span aria-hidden="true">✓</span>
                </button>
                <button
                  type="button"
                  className={`fold__button fold__button--reject${verdict === "rejected" ? " fold__button--on" : ""}`}
                  aria-pressed={verdict === "rejected"}
                  aria-label={`Reject folding ${candidate.word} to ${candidate.base}`}
                  onClick={() => answer(candidate, "rejected")}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="fold__next" onClick={nextBatch}>
        Next batch
      </button>
    </ReviewPage>
  );
}
