import { useCallback } from "react";
import { playAccept, playAchievement, playApplause, playComplete, playJackpot, playReject, playRising, vibrate } from "../audio/sound";
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
  const rising = useCallback(() => playRising(), []);
  const achievement = useCallback(() => playAchievement(), []);

  return { accept, reject, complete, jackpot, applause, rising, achievement };
}
