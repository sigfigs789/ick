import { useCallback } from "react";
import { ReviewPage } from "./ReviewPage";
import { formatWhen, useReviewList } from "./reviewList";
import { fetchSuggestedWords } from "../game/review";

/**
 * The review queue, as a page at /suggested-words.
 *
 * Every word waiting to be triaged into the curated dictionary: the ones players
 * typed into the suggestion box, and the ones the live Merriam-Webster fallback
 * approved mid-game. Both have been one list in the database since 2026-08-20
 * (the `suggested_words` view) and until now that list could only be read from a
 * psql prompt holding the service-role key.
 *
 * Rarest first, which is the order a triage pass wants: a word no corpus attests
 * scores a perfect 10 for whoever finds it, so those are the ones worth judging
 * before anything else.
 *
 * Not linked from anywhere in the app, because it is not a page for players. See
 * src/routes.ts.
 */
export function SuggestedWordsPage() {
  const load = useCallback(() => fetchSuggestedWords(), []);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);

  return (
    <ReviewPage
      title="Suggested words"
      note="Words waiting to be triaged into the dictionary — rarest first."
      count={rows.length}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="Nothing in the queue."
    >
      <ul className="review__list">
        {rows.map((row) => (
          <li key={row.word} className="review__item">
            <div className="review__row">
              <span className="review__word">{row.word}</span>
              <span className="review__zipf" title="Frequency, on the Zipf scale">
                {/* Said rather than shown as a dash: an unattested word is the
                    interesting case on this page, not a missing value. */}
                {row.zipf === null ? "unattested" : `zipf ${row.zipf.toFixed(2)}`}
              </span>
            </div>
            <p className="review__meta">
              <span className={`review__origin review__origin--${row.origin}`}>
                {originLabel(row.origin)}
              </span>
              {/* Counts only when there are any: a live-lookup word has no
                  suggestions and a player's word has no lookups, and printing
                  "0 lookups" on every row would be noise on both. */}
              {row.suggestions > 0 && (
                <span>
                  {row.suggestions} {row.suggestions === 1 ? "suggestion" : "suggestions"}
                </span>
              )}
              {row.lookups > 0 && (
                <span>
                  {row.lookups} {row.lookups === 1 ? "lookup" : "lookups"}
                </span>
              )}
              {row.pos.length > 0 && <span>{row.pos.join(", ")}</span>}
              {row.firstUse && <span>first use {row.firstUse}</span>}
              {row.mwSource && <span>{row.mwSource}</span>}
              {row.lastAt && <span>{formatWhen(row.lastAt)}</span>}
            </p>
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
function originLabel(origin: string): string {
  if (origin === "both") return "asked for + played";
  if (origin === "live-lookup") return "played";
  return "asked for";
}
