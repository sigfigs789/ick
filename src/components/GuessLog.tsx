import { useState } from "react";
import { MAX_GUESSES } from "../game/constants";
import { bestWord } from "../game/rank";
import { topRarityScore, totalRarityScore } from "../game/dictionary";
import { copyText } from "../clipboard";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";

interface Props {
  acceptedWords: AcceptedWord[];
  completed?: boolean;
  streak?: StreakState;
  /** Puzzle date, so scores use the scoring system in effect that day. */
  date?: string;
}

export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
}: Props) {
  const best = bestWord(acceptedWords);
  const guessesLeft = MAX_GUESSES - acceptedWords.length;

  // Tap a logged word to copy it to the clipboard, flashing a brief confirmation.
  const [copiedWord, setCopiedWord] = useState<string | null>(null);

  function copyWord(word: string) {
    void copyText(word);
    setCopiedWord(word);
    window.setTimeout(() => {
      setCopiedWord((current) => (current === word ? null : current));
    }, 1500);
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
            const isCopied = copiedWord === w.word;
            return (
              <li key={w.word} className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}`}>
                <button
                  type="button"
                  className={`guess-log__word-button${isCopied ? " guess-log__word-button--copied" : ""}`}
                  onClick={() => copyWord(w.word)}
                  aria-label={
                    isCopied
                      ? `Copied "${w.word}"`
                      : `Copy "${w.word}" (${w.rarity}, guess ${i + 1})`
                  }
                >
                  {isBest && (
                    <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                      👑
                    </span>
                  )}
                  <span className="guess-log__word">{w.word}</span>
                  <span className="guess-log__copy-hint" aria-hidden="true">
                    {isCopied ? (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path
                          d="M5 12l5 5L19 7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    )}
                  </span>
                </button>
                <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} />
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
