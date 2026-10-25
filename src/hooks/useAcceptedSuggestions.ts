import { useCallback, useEffect, useState } from "react";
import { todayDateString } from "../game/date";
import { headerCelebrationShown } from "../game/headerCelebrations";
import { loadPlayerId } from "../game/player";
import { takesPlayerMessages } from "../game/playerMessages";
import {
  checkSuggestions,
  isFirstAcceptance,
  markThanked,
  unthankedAcceptedWords,
} from "../game/suggestions";

export interface AcceptedSuggestions {
  /**
   * Suggested words that got in and have not been thanked for yet -- every one
   * of them, together -- or none on a day something else has already shown.
   */
  words: readonly string[];
  /** Whether these are the player's first accepted words, which earns a badge. */
  firstAcceptance: boolean;
  dismiss: () => void;
}

function current(): Omit<AcceptedSuggestions, "dismiss"> {
  const words = unthankedAcceptedWords();
  return { words: words.map((w) => w.word), firstAcceptance: isFirstAcceptance(words) };
}

/**
 * The player's suggested words that have been accepted since they were last
 * thanked (see game/suggestions.ts). Asks the server once on mount, when an ask
 * is due, and only on a host that has a suggestion box at all.
 *
 * The thank-you shows only on a day nothing else has: no header celebration
 * card has claimed today (see game/headerCelebrations.ts) and `busy` -- the
 * caller's other things on screen today -- is false. It is decided once, when
 * the words are first known; on a busy day they wait, unthanked, for another.
 * On a quiet day they count as thanked as soon as the notice shows, so each set
 * of accepted words is announced once, and only a later set brings it back.
 */
export function useAcceptedSuggestions(busy: boolean): AcceptedSuggestions {
  const [state, setState] = useState(current);
  const [loaded, setLoaded] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const done = () => {
      if (!live) return;
      setState(current());
      setLoaded(true);
    };
    const player = takesPlayerMessages() ? loadPlayerId() : null;
    if (player) void checkSuggestions(player).then(done);
    else done();
    return () => {
      live = false;
    };
  }, []);

  const { words } = state;
  useEffect(() => {
    if (!loaded || allowed !== null || words.length === 0) return;
    const today = todayDateString();
    const quiet =
      !busy && !headerCelebrationShown("streak", today) && !headerCelebrationShown("news", today);
    // Thanked the moment it shows, closed or not: one notice per set of words,
    // never the same set again on a reload or another day.
    if (quiet) markThanked(words);
    setAllowed(quiet);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on the words' arrival
  }, [loaded, words]);

  const dismiss = useCallback(() => setState({ words: [], firstAcceptance: false }), []);

  if (!allowed) return { words: [], firstAcceptance: false, dismiss };
  return { ...state, dismiss };
}
