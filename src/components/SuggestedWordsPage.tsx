import { useCallback } from "react";
import { MarkBox, MarkToggle, ReviewPage } from "./ReviewPage";
import { formatWhen, useMarks, useReviewList } from "./reviewList";
import { fetchSuggestedWords, hasReviewKey } from "../game/review";
import { curatedRejection, formatRarityScore } from "../game/dictionary";

/**
 * The review queue, as a page at /suggested-words.
 *
 * Every word waiting to be triaged into the curated dictionary: the ones players
 * typed into the suggestion box, and the ones the live Merriam-Webster fallback
 * approved mid-game. Both have been one list in the database since 2026-08-20
 * (the `suggested_words` view) and until now that list could only be read from a
 * psql prompt holding the service-role key.
 *
 * In the order the words arrived, oldest first, because a queue is a queue: the
 * word that has been waiting since August has been waiting longest whatever its
 * frequency turns out to be. Rarest-first was the order the underlying view
 * imposes, and it is still the order you judge in once you are reading the list
 * -- but that is a sort the eye can do, since the frequency is on every row.
 *
 * Each row carries a mark -- accepted, rejected, or nothing yet -- and for a word
 * that mark *is* `word_sightings.status`, the column the dictionary graduation
 * pass already reads. So marking a word here is the same act as marking it from
 * a script, and a word keeps its place on the list once marked rather than
 * vanishing the moment it is judged.
 *
 * Linked from the word rules sheet, to whoever has just suggested a word: the
 * sheet promises that a good word everybody gets to play, and this is where it
 * goes to wait. So most readers here are players looking for their own word,
 * and the triage controls are drawn only for a curator -- somebody holding the
 * `?key=` the marking endpoint requires (see hasReviewKey, and api/review.ts).
 */
export function SuggestedWordsPage() {
  const load = useCallback(() => fetchSuggestedWords(), []);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  const { markFor, cycle, failed } = useMarks("suggested-words", rows);
  const curating = hasReviewKey();

  return (
    <ReviewPage
      title="Suggested words"
      note="Words waiting to be triaged into the dictionary — newest first. A ticked box is one that got in."
      count={rows.length}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nothing in the queue."
      markFailed={failed}
    >
      <ul className="review__list">
        {rows.map((row) => (
          <li
            key={row.word}
            className={`review__item review__item--${markFor(row.word, row.mark) ?? "unmarked"}`}
          >
            {/* The same box either way, and only a curator's is a control:
                everybody sees whether the word got in, and whoever holds the
                key can change the answer. */}
            {curating ? (
              <MarkToggle
                mark={markFor(row.word, row.mark)}
                label={row.word}
                onClick={() => cycle(row.word, row.mark)}
              />
            ) : (
              <MarkBox mark={row.mark} label={row.word} />
            )}
            <div className="review__body">
            <div className="review__row">
              <span className="review__word">{row.word}</span>
              <span
                className="review__zipf"
                title="What this word would score in a puzzle"
              >
                {/* The score a player would see, not the frequency it is
                    computed from: Zipf is the game's internal scale and reads
                    backwards (higher means *more* common), so a queue judged on
                    it was a queue judged in the wrong direction.

                    A word no corpus attests would earn a perfect 10, and that
                    number is not shown. It is the unattested floor rather than
                    a measurement -- printing it would put the queue's least
                    known words at the top of it, which is the opposite of what
                    this list is for. "TBD" is the honest reading: the word has
                    no score anybody has measured, and what it would be handed
                    instead is a placeholder waiting on a decision. */}
                {row.zipf === null ? "TBD" : formatRarityScore(row.zipf)}
              </span>
            </div>
            <p className="review__meta">
              {/* Which door the word came through, in one label, and a word
                  that came through both reads as played.

                  The two are different acts: a guess has to contain the drop,
                  costs one of the day's four, and -- if the live
                  Merriam-Webster check approves it -- scores in that puzzle on
                  the spot; a suggestion satisfies nothing, spends nothing, and
                  asks for the word to exist tomorrow. Played wins a tie because
                  it is the stronger evidence: somebody reached for the word
                  mid-puzzle and a dictionary backed them up, where a suggestion
                  is a word somebody thought of.

                  The count only when a second person asked: one suggestion is
                  the door, not a tally. And the suggestion is the fallback for
                  a row with no live verdict and no event left to count -- the
                  kind a review pass seeded -- because it is the only other way
                  onto this list. */}
              {row.liveApproved ? (
                <span className="review__live">played</span>
              ) : (
                <span>
                  {row.suggestions > 1 ? `${row.suggestions} suggestions` : "suggested"}
                </span>
              )}
              {/* Why the word is unplayable, when the repo has a reason on
                  file. The mark says a word was rejected; this says what the
                  fault was -- a misspelling, a brand name, a word nothing
                  attests -- which is the part a reader cannot work out from a
                  cross. Read from the shipped rejection ledger rather than sent
                  by the endpoint, for the reason the fold is: the verdict is
                  already in the bundle.

                  It can appear on an unmarked row, and that is not a
                  contradiction: the ledger is the repo's decision and the mark
                  is the database's, and a word judged in a review pass may
                  never have been marked here at all. */}
              {rejectionReason(row.word) && (
                <span className="review__rejected">{rejectionReason(row.word)}</span>
              )}
              {row.pos.length > 0 && <span>{row.pos.join(", ")}</span>}
              {row.firstUse && <span>first use {row.firstUse}</span>}
              {row.mwSource && <span>{row.mwSource}</span>}
              {/* When it arrived, which is what the list is ordered on -- the
                  last sighting is a different date on a word that keeps coming
                  back, and putting both on the row would say neither. */}
              {row.firstAt && <span>{formatWhen(row.firstAt)}</span>}
            </p>
            </div>
          </li>
        ))}
      </ul>
    </ReviewPage>
  );
}

/**
 * The fault a reviewed rejection names, as the row says it.
 *
 * The ledger's own token, hyphens turned to spaces and the first letter raised:
 * "Proper noun", "Misspelling", "Not a word". The words are the review pass's
 * own -- rewriting them would put a second vocabulary between the reader and
 * the decision -- and the capital is because this is the one thing on the row
 * that is a verdict rather than a measurement.
 */
function rejectionReason(word: string): string | undefined {
  const reason = curatedRejection(word)?.replace(/-/g, " ");
  return reason && reason[0].toUpperCase() + reason.slice(1);
}

