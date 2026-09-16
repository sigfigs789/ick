import type { ReactNode } from "react";
import { navigate } from "../routes";
import { nextMark, type Mark } from "../game/review";
import type { LoadState } from "./reviewList";

/**
 * The frame both review pages wear: a title, a refresh, the list, and the way
 * back to the puzzle.
 *
 * Shared because the two pages are the same page twice over -- one list read
 * from one endpoint -- and the only thing that differs is what a row is. The
 * rows themselves are each page's own; nothing generic is attempted there,
 * because a queued word and a typed note have nothing in common to generalise.
 */
export function ReviewPage({
  title,
  note,
  count,
  state,
  refreshing,
  onRefresh,
  onRetry,
  empty,
  isEmpty,
  markFailed,
  children,
}: {
  title: string;
  /** What this list is, in one line: these pages have no tab to explain them. */
  note: string;
  /** How many rows came back, said in the heading so a list has a size. */
  count: number;
  state: LoadState;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  /** What to say when the read worked and there was nothing in it. */
  empty: string;
  /**
   * Whether there is nothing to show, where that is not simply `count === 0`.
   *
   * The two queue pages are a count of rows and nothing else, so the count
   * answers it. The freeform report is a tally *and* a list of notes, and a
   * trial with votes but no notes yet has plenty to show -- taking the page
   * away because one of its two halves is empty is the wrong answer to the
   * wrong question.
   */
  isEmpty?: boolean;
  /** Whether a mark failed to save, which the page has to admit to. */
  markFailed?: boolean;
  children: ReactNode;
}) {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {title}
            {state === "ready" && count > 0 && (
              <span className="review__count">{count}</span>
            )}
          </h1>
          <p className="page-head__note">{note}</p>
        </div>
        <button
          type="button"
          className="app__icon-button leaderboard-page__refresh"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh"
          data-refreshing={refreshing ? "" : undefined}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      {state === "loading" && <p className="review__status">Loading…</p>}
      {state === "error" && (
        <p className="review__status">
          Couldn{"’"}t load this list.{" "}
          <button type="button" className="review__retry" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
      {state === "ready" && (isEmpty ?? count === 0) && (
        <p className="review__status">{empty}</p>
      )}
      {/* Above the list rather than on the row that failed: the mark has
          already snapped back there, and what a reader needs next is the reason
          and the knowledge that nothing was saved. */}
      {markFailed && (
        <p className="review__failed" role="status">
          Couldn{"’"}t save that mark — it{"’"}s been put back.
        </p>
      )}
      {state === "ready" && !(isEmpty ?? count === 0) && children}

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

/**
 * The mark on one row: a checkbox that is three things.
 *
 * Empty, a tick, a cross, and round again on the next click. A native checkbox
 * would have been two of those and no way to say "rejected" as distinct from
 * "not looked at yet", which is the distinction the whole control exists for --
 * so it is a button that reports its own state, and the accessible name says
 * both where it stands and what the next click will do. Nothing about the cycle
 * is discoverable from the glyph alone, and that is what the name is for.
 */
export function MarkToggle({
  mark,
  /** What this mark is about -- a word, or a note's date -- for the name. */
  label,
  onClick,
}: {
  mark: Mark;
  label: string;
  onClick: () => void;
}) {
  const state = mark ?? "unmarked";
  const next = nextMark(mark);
  const nextSaid = next === null ? "clears the mark" : `marks it ${next}`;
  return (
    <button
      type="button"
      className={`review__mark review__mark--${state}`}
      onClick={onClick}
      aria-label={`${label}: ${state}. Next click ${nextSaid}.`}
      title={`${state} — click to ${next === null ? "clear" : next === "accepted" ? "accept" : "reject"}`}
    >
      <span aria-hidden="true">
        {mark === "accepted" ? "✓" : mark === "rejected" ? "✕" : ""}
      </span>
    </button>
  );
}

/**
 * The same mark, for somebody who is only reading: a tick if the row was
 * accepted, a cross if it was rejected, an empty box if nobody has judged it
 * yet.
 *
 * The box is the whole point rather than a decoration on a control. These pages
 * are linked from the game, and the first question a player has about the word
 * they suggested is whether it got in -- which the mark has always answered and
 * only a curator could see. A span and not a disabled button: there is nothing
 * here to press, and a control that cannot be used is a worse way of saying so
 * than no control.
 */
export function MarkBox({ mark, label }: { mark: Mark; label: string }) {
  const state = mark ?? "unmarked";
  const said =
    mark === "accepted"
      ? "accepted"
      : mark === "rejected"
        ? "rejected"
        : "not judged yet";
  return (
    <span
      className={`review__mark review__mark--${state} review__mark--static`}
      role="img"
      aria-label={`${label}: ${said}`}
      title={said}
    >
      <span aria-hidden="true">
        {mark === "accepted" ? "✓" : mark === "rejected" ? "✕" : ""}
      </span>
    </span>
  );
}
