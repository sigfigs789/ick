// The parts of the two review pages that are not components: the read that
// feeds a list, and the way a timestamp is written. Their own file for the
// reason rarityStyles.ts is: a module that exports a component and a helper
// side by side breaks fast refresh for the component.
import { useCallback, useEffect, useState } from "react";

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

  const read = useCallback(() => {
    load()
      .then((next) => {
        setRows(next);
        setState("ready");
      })
      // Unlike the finds feed, a failed re-read is not swallowed: these lists are
      // not polled, so every read here is one somebody asked for, and quietly
      // leaving the old rows up would answer a question they did not ask.
      .catch(() => setState("error"));
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
