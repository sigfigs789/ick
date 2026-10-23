import { useEffect, useState } from "react";
import { rejectionMetadataLoaded, rejectionMetadataReady } from "../game/submit";

/**
 * Whether the rejection metadata has arrived, as a piece of React state.
 *
 * A view that judges words while it renders -- the copy previews, the found
 * words feed -- reads it only as a trigger, so it judges them again once the
 * file is in (see `rejectionMetadataReady` in game/submit.ts). Before then a
 * word the metadata refuses looks like an unknown one.
 */
export function useRejectionMetadataLoaded(): boolean {
  const [loaded, setLoaded] = useState(rejectionMetadataLoaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void rejectionMetadataReady.then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [loaded]);
  return loaded;
}
