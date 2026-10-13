/**
 * Which puzzle the game is showing, for the parts of the app outside the game
 * that care -- the chat opens on it, and its unread dot is about it.
 *
 * The game owns the date (hooks/useDailyPuzzle.ts) and announces it here; on a
 * page that is not the game, it is whatever the game was last on, or today's
 * puzzle if the game has not been opened this visit.
 */
import { todayDateString } from "./date";

let viewed: string | null = null;
const listeners = new Set<(date: string) => void>();

export function viewedPuzzle(): string {
  return viewed ?? todayDateString();
}

export function setViewedPuzzle(date: string): void {
  if (date === viewed) return;
  viewed = date;
  for (const listener of listeners) listener(date);
}

/** Called with the new date whenever the game moves to another puzzle. */
export function onViewedPuzzle(listener: (date: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
