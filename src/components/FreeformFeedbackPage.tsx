import { useCallback } from "react";
import { formatWhen, useReviewList } from "./reviewList";
import { ReviewPage } from "./ReviewPage";
import { fetchFreeform, type FreeformVerdict } from "../game/review";

/**
 * Where the Freeform week trial stands, as a page at /freeform-feedback.
 *
 * The week put a question to the players -- keep scoring words as they are
 * typed, or go back to rescoring them to their common form -- and collected the
 * answer in two pieces: a tap, and a box to say more (see
 * components/FreeformModal.tsx). This page is those two pieces side by side,
 * because neither settles the question alone. The tally says how the room
 * voted; the notes say what the room actually wants, which in this trial has
 * already turned out to be a thing neither button offered.
 *
 * Read-only, unlike the other two review pages. There is nothing to triage
 * here: a vote is counted, not judged, and a note about a trial is read once
 * and acted on in the design rather than ticked off a list.
 *
 * Not linked from anywhere, and that is load-bearing rather than incidental --
 * a running tally shown to the players still voting is a poll that campaigns
 * for itself.
 */
export function FreeformFeedbackPage() {
  const load = useCallback(async () => [await fetchFreeform()], []);
  const { rows, state, refreshing, refresh, retry } = useReviewList(load);
  // `useReviewList` reads lists, and this page is one object; it is wrapped in a
  // single-element array above rather than given a second loader of its own,
  // since the three states a read has -- loading, ready, could-not-load -- are
  // the whole of what that hook is for and are exactly the three this page
  // needs.
  const verdict: FreeformVerdict | undefined = rows[0];
  const votes = (verdict?.tally.love ?? 0) + (verdict?.tally.boo ?? 0);

  return (
    <ReviewPage
      title="Freeform week"
      note="How the vote stands, and what players wrote underneath it."
      // The notes, because that is the list on the page. The votes get their own
      // count in the tally below, where it means something different.
      count={verdict?.notes.length ?? 0}
      state={state}
      refreshing={refreshing}
      onRefresh={refresh}
      onRetry={retry}
      empty="No votes or notes yet."
      // A trial with votes and no notes yet is not an empty page: the tally is
      // the half of it that decides anything.
      isEmpty={votes === 0 && (verdict?.notes.length ?? 0) === 0}
    >
      {verdict && (
        <>
          <section className="freeform-report__tally" aria-label="The vote">
            {votes === 0 ? (
              <p className="review__status">Nobody has voted yet.</p>
            ) : (
              <>
                <div className="freeform-report__counts">
                  <Side
                    label="Love it"
                    emoji="❤️"
                    count={verdict.tally.love}
                    total={votes}
                    tone="love"
                  />
                  <Side
                    label="Boooo"
                    emoji="👎"
                    count={verdict.tally.boo}
                    total={votes}
                    tone="boo"
                  />
                </div>
                {/* Said rather than left to be inferred from two numbers: the
                    tally is a count of players and not of taps (one player who
                    changed their mind is one row), and a reader deciding a
                    trial on it should know which of those they are reading. */}
                <p className="review__meta">
                  {votes} {votes === 1 ? "player" : "players"}, latest vote each.
                </p>
                {verdict.byDate.length > 1 && (
                  <>
                    {/* Above the table rather than in a `<caption>`: this is a
                        sentence about why the breakdown is worth reading, and
                        it belongs where a reader meets it before the numbers. */}
                    <p className="review__meta freeform-report__days-note">
                      By the puzzle they were on when they voted — the first day
                      is a first impression of the notice, the last is a week of
                      playing under the rules.
                    </p>
                    <table className="freeform-report__days">
                      <thead>
                        <tr>
                          <th scope="col">Puzzle</th>
                          <th scope="col">Love it</th>
                          <th scope="col">Boooo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verdict.byDate.map((day) => (
                          <tr key={day.date}>
                            <th scope="row">{day.date}</th>
                            <td>{day.love}</td>
                            <td>{day.boo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </section>

          <h2 className="freeform-report__heading">
            Notes{verdict.notes.length > 0 && (
              <span className="review__count">{verdict.notes.length}</span>
            )}
          </h2>
          {verdict.notes.length === 0 ? (
            <p className="review__status">Nobody has written one yet.</p>
          ) : (
            <ul className="review__list">
              {verdict.notes.map((note) => (
                <li key={note.id} className="review__item">
                  <div className="review__body">
                    {/* Text and nothing else -- no links made of it, no markup
                        read out of it. It is free text a stranger typed, and
                        the one job this page has is to put it in front of
                        somebody who will read it. */}
                    <p className="review__note">{note.text}</p>
                    <p className="review__meta">
                      <span>{formatWhen(note.at)}</span>
                      {note.date && <span>puzzle {note.date}</span>}
                      {/* The side this writer came down on, which is most of
                          what turns a note into evidence: "it needs two scores"
                          from somebody who voted Love is a different sentence
                          from the same words under a Boooo. Absent where they
                          never tapped anything, rather than guessed at. */}
                      <span>
                        {note.vote === "love"
                          ? "voted Love it"
                          : note.vote === "boo"
                            ? "voted Boooo"
                            : "no vote"}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ReviewPage>
  );
}

/**
 * One side of the vote: the count, and what share of the room it is.
 *
 * The share matters more than the count on a trial this small -- three to one
 * and thirty to ten are the same verdict and read very differently as bare
 * numbers -- and both are shown because a percentage of four voters would
 * otherwise sound like a mandate.
 */
function Side({
  label,
  emoji,
  count,
  total,
  tone,
}: {
  label: string;
  emoji: string;
  count: number;
  total: number;
  tone: "love" | "boo";
}) {
  const share = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className={`freeform-report__side freeform-report__side--${tone}`}>
      <span className="freeform-report__side-label">
        <span aria-hidden="true">{emoji}</span> {label}
      </span>
      <span className="freeform-report__side-count">{count}</span>
      <span className="freeform-report__side-share">{share}%</span>
      {/* A bar drawn from the same share the text gives, so it can only ever
          agree with it. Hidden from the reader who is being read to: the two
          numbers above it have already said this. */}
      <span className="freeform-report__bar" aria-hidden="true">
        <span
          className="freeform-report__bar-fill"
          style={{ width: `${share}%` }}
        />
      </span>
    </div>
  );
}
