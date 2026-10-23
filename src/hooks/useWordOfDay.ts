import { useEffect, useRef, useState } from "react";
import { isReporting, trackWordOfDayAssigned } from "../analytics";
import {
  assignWordOfDayVariant,
  currentWordOfDayVariant,
  forcedWordOfDayVariant,
  type WordOfDayVariant,
} from "../game/wordOfDay";

/**
 * Whether to show the word of the day (see game/wordOfDay.ts).
 *
 * `finished` is the moment the section would first appear, and is when the arm
 * is drawn. A forced arm (`?word-of-day=hidden`) wins and reports nothing; a
 * host that reports nothing (the Reddit post) shows the word as it always has,
 * since nobody would measure the draw.
 * Until a fresh draw lands the word stays hidden, which is one frame at most.
 */
export function useWordOfDay(finished: boolean, date: string | undefined): boolean {
  const forced = useRef(forcedWordOfDayVariant()).current;
  const [variant, setVariant] = useState<WordOfDayVariant | null>(() => currentWordOfDayVariant() ?? null);

  useEffect(() => {
    if (forced || !finished || !isReporting()) return;
    // StrictMode runs this twice, and the second run finds the arm already
    // stored, so the draw is reported once.
    const drawn = assignWordOfDayVariant();
    if (!drawn) {
      // Storage that cannot keep a draw keeps the browser out of the test.
      setVariant("shown");
      return;
    }
    if (drawn.fresh && date) trackWordOfDayAssigned(drawn.variant, date);
    setVariant(drawn.variant);
  }, [forced, finished, date]);

  if (forced) return forced === "shown";
  if (!isReporting()) return true;
  return variant === "shown";
}
