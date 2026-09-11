import type { ReactNode } from "react";
import { navigate } from "../routes";
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
      {state === "ready" && count === 0 && <p className="review__status">{empty}</p>}
      {state === "ready" && count > 0 && children}

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
