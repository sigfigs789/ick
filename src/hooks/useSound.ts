import { useCallback, useState } from "react";
import { playAccept, playComplete, playReject } from "../audio/sound";
import type { Rarity } from "../game/types";

const SOUND_KEY = "ick:soundEnabled";

function loadEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== "off";
}

export function useSound() {
  const [enabled, setEnabled] = useState(loadEnabled);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  const accept = useCallback((rarity: Rarity) => enabled && playAccept(rarity), [enabled]);
  const reject = useCallback(() => enabled && playReject(), [enabled]);
  const complete = useCallback(() => enabled && playComplete(), [enabled]);

  return { enabled, toggle, accept, reject, complete };
}
