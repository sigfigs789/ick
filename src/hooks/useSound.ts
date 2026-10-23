import { useCallback } from "react";
import { playAccept, playApplause, playComplete, playReject, playRising } from "../audio/sound";
import type { Rarity } from "../game/types";

export function useSound() {
  const accept = useCallback((rarity: Rarity) => playAccept(rarity), []);
  const reject = useCallback(() => playReject(), []);
  const complete = useCallback(() => playComplete(), []);
  const applause = useCallback((closed: "week" | "month") => playApplause(closed), []);
  const rising = useCallback(() => playRising(), []);

  return { accept, reject, complete, applause, rising };
}
