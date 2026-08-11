import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  acceptedWords: AcceptedWord[];
  /** Clicking a logged word loads it back into the guess input for tweaking. */
  onSelectWord: (word: string) => void;
  completed?: boolean;
  streak?: StreakState;
}

export function GuessLog({
  acceptedWords,
  onSelectWord,
  completed = false,
  streak,
}: Props) {
  const best = bestWord(acceptedWords);
  const guessesLeft = MAX_GUESSES - acceptedWords.length;

  return (
    <section className={`guess-log${completed ? " guess-log--completed" : ""}`} aria-label="Your guesses">
      {!completed && (
        <div className="guess-log__header">
          <h2 className="guess-log__title">Guess log</h2>
          <span className="guess-log__count">
            {acceptedWords.length} of {MAX_GUESSES} used
          </span>
        </div>
      )}

      {acceptedWords.length === 0 ? (
        <p className="guess-log__empty">
          No guesses yet — enter a word below that contains the drop.
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

      {!completed && guessesLeft > 0 && acceptedWords.length > 0 && (
        <p className="guess-log__remaining">
          {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left. Aim for the highest rarity you can find.
        </p>
      )}

      {completed && streak && (
        <div className="guess-log__completion-trackers">
          <StreakDisplay streak={streak} />
        </div>
      )}
    </section>
  );
}
