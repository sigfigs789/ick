// The parts of the two review pages that are not components: the read that
// feeds a list, and the way a timestamp is written. Their own file for the
// reason rarityStyles.ts is: a module that exports a component and a helper
// side by side breaks fast refresh for the component.
import { useCallback, useEffect, useRef, useState } from "react";
import { nextMark, setMark, type Mark } from "../game/review";

export type LoadState = "loading" | "ready" | "error";

/**
 * One read of a review list, with the three states a page has to say out loud.
 *
 * An empty list is a real answer here -- a queue can genuinely be empty, and so
 * can a day's feedback -- so "still loading", "nothing to show" and "could not
 * load" are three different sentences rather than one blank page. Same reasoning
 * as the finds feed (see FoundWordsPage), and the same shape.
 */
export function useReviewList<T>(load: () => Promise<T[]>): {
  rows: readonly T[];
  state: LoadState;
  refreshing: boolean;
  refresh: () => void;
  retry: () => void;
} {
  const [rows, setRows] = useState<readonly T[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);

  // Only the latest read may land: a page whose `load` changes (a new window on
  // /analyticsV2) would otherwise draw whichever answer came back last.
  const latest = useRef(0);
  const read = useCallback(() => {
    const id = ++latest.current;
    load()
      .then((next) => {
        if (id !== latest.current) return;
        setRows(next);
        setState("ready");
      })
      // Unlike the finds feed, a failed re-read is not swallowed: these lists are
      // not polled, so every read here is one somebody asked for, and quietly
      // leaving the old rows up would answer a question they did not ask.
      .catch(() => id === latest.current && setState("error"));
  }, [load]);

  useEffect(() => {
    read();
  }, [read]);

  return {
    rows,
    state,
    refreshing,
    refresh: () => {
      setRefreshing(true);
      read();
      // Ends on its own rather than on the request, so a hung fetch cannot leave
      // the button disabled. The list underneath stays readable throughout.
      window.setTimeout(() => setRefreshing(false), 600);
    },
    retry: () => {
      setState("loading");
      read();
    },
  };
}

/** A timestamp as a date and time, in the reader's own zone. */
export function formatWhen(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The marks on a list, drawn at once and saved behind the click.
 *
 * A mark is a click on a row and a round trip to the database, and those two
 * cannot be made to happen together: waiting for the write before moving the
 * tick would make every mark feel like a page load, on a page whose whole job is
 * to be marked up quickly. So the click moves the control, the write follows,
 * and the answer the database gives is what the control ends up showing --
 * including when that answer is "no".
 *
 * A failure puts the mark back where it was and says so. The alternative, a tick
 * left standing over a row nothing was saved for, is the one outcome a tracking
 * control must never produce: the marks would be a record of what was clicked
 * rather than of what was decided.
 */
export function useMarks(
  list: "suggested-words" | "feedback",
  /** The rows on screen, so a fresh read clears marks it has answered for. */
  rows: readonly unknown[],
): {
  /** The mark to draw for a row: the click's, if there has been one. */
  markFor: (ref: string | number, stored: Mark) => Mark;
  /** Move a row to its next mark, and save it. */
  cycle: (ref: string | number, stored: Mark) => void;
  /** Whether the last save failed, for the page to say out loud. */
  failed: boolean;
} {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [failed, setFailed] = useState(false);

  // A list that has just been re-read carries the marks the database holds, so
  // the clicks this page remembers have been answered and are only a way for a
  // stale one to hide a fresh one.
  useEffect(() => {
    setMarks({});
  }, [rows]);

  const markFor = useCallback(
    (ref: string | number, stored: Mark): Mark => {
      const key = String(ref);
      return key in marks ? marks[key] : stored;
    },
    [marks],
  );

  const cycle = useCallback(
    (ref: string | number, stored: Mark) => {
      const key = String(ref);
      const current = key in marks ? marks[key] : stored;
      const wanted = nextMark(current);
      setFailed(false);
      setMarks((was) => ({ ...was, [key]: wanted }));
      setMark(list, ref, wanted)
        // Drawn from the answer rather than left on the guess. They agree in
        // every ordinary case; when they do not, the database is right.
        .then((saved) => setMarks((was) => ({ ...was, [key]: saved })))
        .catch(() => {
          setMarks((was) => ({ ...was, [key]: current }));
          setFailed(true);
        });
    },
    [list, marks],
  );

  return { markFor, cycle, failed };
}
