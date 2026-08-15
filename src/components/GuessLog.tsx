import { useRef, useState } from "react";
import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { topRarityScore, totalRarityScore } from "../game/dictionary";
import { copyText } from "../clipboard";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";

/** How long to hold a logged word before it copies instead of reselecting. */
const LONG_PRESS_MS = 500;

interface Props {
  acceptedWords: AcceptedWord[];
  /** Clicking a logged word loads it back into the guess input for tweaking. */
  onSelectWord: (word: string) => void;
  completed?: boolean;
  streak?: StreakState;
  /** Puzzle date, so scores use the scoring system in effect that day. */
  date?: string;
}

export function GuessLog({
  acceptedWords,
  onSelectWord,
  completed = false,
  streak,
  date,
}: Props) {
  const best = bestWord(acceptedWords);
  const guessesLeft = MAX_GUESSES - acceptedWords.length;

  // A logged word can be copied two ways: tap the copy icon, or long-press the
  // word itself. Both funnel through copyWord, which flashes a "copied" state.
  const [copiedWord, setCopiedWord] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);

  function copyWord(word: string) {
    void copyText(word);
    setCopiedWord(word);
    window.setTimeout(() => {
      setCopiedWord((current) => (current === word ? null : current));
    }, 1500);
  }

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function startPress(word: string) {
    didLongPress.current = false;
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      // A held press copies and sets the ref so the ensuing click doesn't also
      // reload the word into the input.
      didLongPress.current = true;
      copyWord(word);
    }, LONG_PRESS_MS);
  }

  function handleWordClick(word: string) {
    if (didLongPress.current) {
      // Swallow the click that follows a long press so we don't also reuse the word.
      didLongPress.current = false;
      return;
    }
    onSelectWord(word);
  }

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
                  onClick={() => handleWordClick(w.word)}
                  onPointerDown={() => startPress(w.word)}
                  onPointerUp={clearPressTimer}
                  onPointerLeave={clearPressTimer}
                  onPointerCancel={clearPressTimer}
                  onContextMenu={(e) => e.preventDefault()}
                  aria-label={`Reuse "${w.word}" (${w.rarity}, guess ${i + 1}) in the input, or hold to copy`}
                >
                  {isBest && (
                    <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                      👑
                    </span>
                  )}
                  <span className="guess-log__word">{w.word}</span>
                </button>
                <div className="guess-log__entry-meta">
                  <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} />
                  <button
                    type="button"
                    className={`guess-log__copy-button${
                      copiedWord === w.word ? " guess-log__copy-button--copied" : ""
                    }`}
                    onClick={() => copyWord(w.word)}
                    aria-label={
                      copiedWord === w.word ? `Copied "${w.word}"` : `Copy "${w.word}"`
                    }
                  >
                    {copiedWord === w.word ? (
                      <>
                        <svg
                          className="guess-log__copy-icon"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 12l5 5L19 7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="guess-log__copy-label">Copied</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="guess-log__copy-icon"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          aria-hidden="true"
                        >
                          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                          <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                        <span className="guess-log__copy-label">Copy</span>
                      </>
                    )}
                  </button>
                </div>
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
          <StreakDisplay
            streak={streak}
            totalRarity={totalRarityScore(acceptedWords, date)}
            topRarity={topRarityScore(acceptedWords, date)}
            date={date}
          />
        </div>
      )}
    </section>
  );
}
