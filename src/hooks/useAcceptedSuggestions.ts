import { useCallback, useEffect, useState } from "react";
import { loadPlayerId } from "../game/player";
import { takesPlayerMessages } from "../game/playerMessages";
import {
  checkSuggestions,
  isFirstAcceptance,
  markThanked,
  unthankedAcceptedWords,
} from "../game/suggestions";

export interface AcceptedSuggestions {
  /** Suggested words that got in and have not been thanked for yet. */
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
 */
export function useAcceptedSuggestions(): AcceptedSuggestions {
  const [state, setState] = useState(current);

  useEffect(() => {
    if (!takesPlayerMessages()) return;
    const player = loadPlayerId();
    if (!player) return;
    let live = true;
    void checkSuggestions(player).then(() => {
      if (live) setState(current());
    });
    return () => {
      live = false;
    };
  }, []);

  const { words } = state;
  const dismiss = useCallback(() => {
    markThanked(words);
    setState({ words: [], firstAcceptance: false });
  }, [words]);

  return { ...state, dismiss };
}
