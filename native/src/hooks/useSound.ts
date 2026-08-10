import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { playAccept, playComplete, playReject } from "../audio/sound";
import type { Rarity } from "../game/types";

const SOUND_KEY = "ink:soundEnabled";

export function useSound() {
  // Starts enabled by default and corrects itself once the persisted
  // preference loads from AsyncStorage (async, unlike localStorage on web,
  // so there's a brief instant before the real value is known).
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(SOUND_KEY).then((v) => {
      if (v === "off") setEnabled(false);
    });
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(SOUND_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  const accept = useCallback((rarity: Rarity) => enabled && playAccept(rarity), [enabled]);
  const reject = useCallback(() => enabled && playReject(), [enabled]);
  const complete = useCallback(() => enabled && playComplete(), [enabled]);

  return { enabled, toggle, accept, reject, complete };
}
