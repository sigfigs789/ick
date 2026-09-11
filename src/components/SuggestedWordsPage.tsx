import { useCallback } from "react";
import { MarkBox, MarkToggle, ReviewPage } from "./ReviewPage";
import { formatWhen, useMarks, useReviewList } from "./reviewList";
import { fetchSuggestedWords, hasReviewKey } from "../game/review";
import { baseFormSubstitution, formatRarityScore, unattestedZipf } from "../game/dictionary";

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

                    A word no corpus attests still has a score -- the unattested
                    floor, which is a perfect 10 -- and it is worth saying both:
                    the 10 is what the word would earn, and "unattested" is why
                    nobody should trust it. */}
                {formatRarityScore(row.zipf ?? unattestedZipf())}
                {row.zipf === null && " · unattested"}
              </span>
            </div>
            <p className="review__meta">
              <span className={`review__origin review__origin--${row.origin}`}>
                {originLabel(row.origin)}
              </span>
              {/* Only when there are any: a word that arrived by live lookup has
                  no suggestions, and "0 suggestions" on every one of those rows
                  would be noise.

                  The lookup count used to sit beside this and no longer does.
                  Whether a word was reached in a puzzle is already on the row --
                  that is what "played" means -- and how many times it was reached
                  was a number nobody triaged on. The endpoint still reports it. */}
              {row.suggestions > 0 && (
                <span>
                  {row.suggestions} {row.suggestions === 1 ? "suggestion" : "suggestions"}
                </span>
              )}
              {/* The game let this one be played on the spot, on the live
                  Merriam-Webster check and nobody's judgement. Worth its own
                  label beside the mark: a word can be live-lookup approved and
                  still be rejected from the dictionary afterwards. */}
              {row.liveApproved && (
                <span className="review__live">live lookup approved</span>
              )}
              {/* What the word would score as, if it is in the dictionary and
                  the fold caps it at something more common -- "abaci" scores as
                  "abacus". Computed here rather than sent: the fold is the
                  shipped dictionary's own rule, and this page has it. A word
                  still waiting to be added is not in it, so this stays empty
                  until the word is actually playable. */}
              {commonForm(row.word) && (
                <span className="review__fold">
                  common form {commonForm(row.word)}
                </span>
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
 * Where a candidate came from, in words.
 *
 * "Both" is the strongest signal the queue has -- a player asked for the word
 * *and* somebody reached for it in a puzzle -- so it is worth naming rather than
 * leaving as a database token.
 */
/**
 * The more common word this one's score folds onto, if any.
 *
 * Only ever answers for a word the shipped dictionary already contains, which
 * on this page means a word that has been accepted and regenerated in. For
 * everything still queued it is undefined, and the row says nothing -- the fold
 * is a fact about a playable word, and guessing at one for a word the
 * dictionary has never seen would be inventing it.
 */
function commonForm(word: string): string | undefined {
  return baseFormSubstitution(word)?.base;
}

function originLabel(origin: string): string {
  if (origin === "both") return "asked for + played";
  if (origin === "live-lookup") return "played";
  return "asked for";
}
