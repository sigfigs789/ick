import { useEffect, useState } from "react";
import { wordDataLoaded, wordDataReady } from "../game/wordData";

/**
 * Whether the word data fetched after the app starts has arrived for `date`'s
 * puzzle, as a piece of React state.
 *
 * A view that judges or scores words while it renders -- the copy previews,
 * the found words feed, the guess log's base-form notes, the learnable word --
 * reads it as a trigger, so it judges them again once the files are in (see
 * game/wordData.ts). Before then a word the metadata refuses looks like an
 * unknown one, and a word priced off an estimate or a reviewed fold shows the
 * score it would have had without it.
 */
export function useWordDataLoaded(date?: string): boolean {
  const [loaded, setLoaded] = useState(() => wordDataLoaded(date));
  useEffect(() => {
    if (wordDataLoaded(date)) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    let live = true;
    wordDataReady(date).then(
      () => {
        if (live) setLoaded(true);
      },
      // A file that failed twice is retried by the next submission; the view
      // keeps what it shows until then.
      () => {}
    );
    return () => {
      live = false;
    };
  }, [date]);
  return loaded;
}
