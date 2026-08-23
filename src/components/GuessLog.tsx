import { useState } from "react";
import { maxGuessesFor } from "../game/constants";
import { bestWord } from "../game/rank";
import {
  baseFormSubstitution,
  formatRarityScore,
  topRarityScore,
  totalRarityScore,
} from "../game/dictionary";
import { copyText } from "../clipboard";
import { raritySymbol } from "../game/share";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";

/** The clipboard form of a logged word: "<tier square> <word> (<score>)".
 * Reuses the share-results palette so a pasted word matches the share text. */
function copyTextForWord(w: AcceptedWord, date?: string): string {
  const score = w.zipf !== undefined ? ` (${formatRarityScore(w.zipf, date)})` : "";
  return `${raritySymbol(w.rarity, date)} ${w.word}${score}`;
}

/**
 * The other word in `w`'s paradigm that its score actually came from, or
 * undefined when it scored on its own frequency.
 *
 * The score a rare-looking word displays is often not its own: the engine caps
 * every word at the most common member of its family, so "placation" shows
 * "placate" and -- since the fold gained its second direction -- "infatuate"
 * shows "infatuated". Players read the number as a claim about the word they
 * typed, so a word scoring well below where they expected looks like the game
 * being wrong rather than the game being careful. Naming the form it was scored
 * as turns that into the thing it should have been all along: something learned
 * about the word.
 */
function scoredAs(w: AcceptedWord, date?: string): string | undefined {
  return baseFormSubstitution(w.word, date)?.base;
}

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
  const maxGuesses = maxGuessesFor(date);
  const guessesLeft = maxGuesses - acceptedWords.length;

  // Tap a logged word to copy it to the clipboard, flashing a brief confirmation.
  const [copiedWord, setCopiedWord] = useState<string | null>(null);

  function copyWord(w: AcceptedWord) {
    void copyText(copyTextForWord(w, date));
    setCopiedWord(w.word);
    window.setTimeout(() => {
      setCopiedWord((current) => (current === w.word ? null : current));
    }, 1500);
  }

  return (
    <section className={`guess-log${completed ? " guess-log--completed" : ""}`} aria-label="Your guesses">
      {!completed && (
        <div className="guess-log__header">
          <h2 className="guess-log__title">Guess log</h2>
          <span className="guess-log__count">
            {acceptedWords.length} of {maxGuesses} used
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
            const scored = scoredAs(w, date);
            return (
              <li key={w.word} className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}`}>
                <button
                  type="button"
                  className={`guess-log__entry-button${isCopied ? " guess-log__entry-button--copied" : ""}`}
                  onClick={() => copyWord(w)}
                  aria-label={
                    isCopied
                      ? `Copied "${w.word}"`
                      : `Copy "${w.word}" (${w.rarity}, guess ${i + 1}${
                          scored ? `, scored as "${scored}"` : ""
                        })`
                  }
                >
                  <span className="guess-log__entry-main">
                    {isBest && (
                      <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                        👑
                      </span>
                    )}
                    <span className="guess-log__entry-text">
                      <span className="guess-log__word">{w.word}</span>
                      {scored && (
                        <span className="guess-log__scored-as">
                          scored as <b>{scored}</b>
                        </span>
                      )}
                    </span>
                    {isCopied ? (
                      <span className="guess-log__copied" role="status">
                        Copied!
                      </span>
                    ) : (
                      <span className="guess-log__copy-hint" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                          <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span className="guess-log__entry-meta">
                    <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} />
                  </span>
                </button>
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
