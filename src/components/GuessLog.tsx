import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { RarityBadge } from "./RarityBadge";
import type { AcceptedWord } from "../game/types";

interface Props {
  acceptedWords: AcceptedWord[];
  /** Clicking a logged word loads it back into the guess input for tweaking. */
  onSelectWord: (word: string) => void;
}

export function GuessLog({ acceptedWords, onSelectWord }: Props) {
  const best = bestWord(acceptedWords);
  const guessesLeft = MAX_GUESSES - acceptedWords.length;

  return (
    <section className="guess-log" aria-label="Your guesses">
      <div className="guess-log__header">
        <h2 className="guess-log__title">Guess log</h2>
        <span className="guess-log__count">
          {acceptedWords.length} of {MAX_GUESSES} used
        </span>
      </div>

      {acceptedWords.length === 0 ? (
        <p className="guess-log__empty">
          No guesses yet — enter a word below that contains the fragment.
        </p>
      ) : (
        <ol className="guess-log__list">
          {acceptedWords.map((w, i) => {
            const isBest = best !== undefined && w.word === best.word;
            return (
              <li key={w.word} className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}`}>
                <button
                  type="button"
                  className="guess-log__word-button"
                  onClick={() => onSelectWord(w.word)}
                  aria-label={`Reuse "${w.word}" (${w.rarity}, guess ${i + 1}) in the input`}
                >
                  {isBest && (
                    <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                      👑
                    </span>
                  )}
                  <span className="guess-log__word">{w.word}</span>
                </button>
                <RarityBadge rarity={w.rarity} zipf={w.zipf} />
              </li>
            );
          })}
        </ol>
      )}

      {guessesLeft > 0 && acceptedWords.length > 0 && (
        <p className="guess-log__remaining">
          {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left. Aim for the highest rarity you can find.
        </p>
      )}
    </section>
  );
}
