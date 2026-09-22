import { useCallback, useEffect, useState } from "react";
import { currentMode, setMode, subscribeToMode, type GameMode } from "../game/mode";

/**
 * The mode the player is in, as a piece of React state.
 *
 * The mode itself is a module variable in game/mode.ts, because scoring reads it
 * from a hundred places that have no business taking it as an argument. React
 * cannot see a value it was never handed, so the setter publishes and this
 * subscribes -- which is what makes flipping the switch repaint the puzzle, the
 * boards and the share text in one go.
 *
 * Every mounted copy shares the one value, so two components asking are two
 * components agreeing.
 */
export function useGameMode(): [GameMode, (mode: GameMode) => void] {
  const [mode, setLocal] = useState<GameMode>(currentMode);
  useEffect(() => subscribeToMode(setLocal), []);
  const choose = useCallback((next: GameMode) => setMode(next), []);
  return [mode, choose];
}
