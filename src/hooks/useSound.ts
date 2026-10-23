import { useCallback } from "react";
import { playAccept, playApplause, playComplete, playJackpot, playReject, vibrate } from "../audio/sound";
import { hapticPatternFor } from "../game/celebration";
import type { Rarity } from "../game/types";

export function useSound() {
  const accept = useCallback((rarity: Rarity) => {
    playAccept(rarity);
    vibrate(hapticPatternFor(rarity));
  }, []);
  const reject = useCallback(() => playReject(), []);
  const complete = useCallback(() => playComplete(), []);
  const jackpot = useCallback(() => playJackpot(), []);
  const applause = useCallback((closed: "week" | "month") => playApplause(closed), []);

  return { accept, reject, complete, jackpot, applause };
}
