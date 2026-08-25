import { useState } from "react";
import { maxGuessesFor } from "../game/constants";
import { bestWord } from "../game/rank";
import {
  baseFormRankDrop,
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
            // Only surfaced when the fold cost the word a rank (see
            // baseFormRankDrop): a badge one or more tiers below what the word
            // itself suggests looks broken until the player is shown the word
            // it was scored from.
            //
            // "common form" rather than "base word", because the fold does not
            // only run toward bases. It takes the most common word in the
            // family, which may be one built *on* the word ("infatuate" scores
            // as "infatuated", "neolith" as "neolithic") or a cousin reached
            // through the chain ("overbake" as "baking"). 5,345 of the words
            // carrying this note name something that is not a base of theirs by
            // any reading, and calling a plural the base word of its own
            // singular reads as the bug it is meant to explain away.
            const baseNote = baseFormRankDrop(w.word, date);
            return (
              <li key={w.word} className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}`}>
                <button
                  type="button"
                  className={`guess-log__entry-button${isCopied ? " guess-log__entry-button--copied" : ""}`}
                  onClick={() => copyWord(w)}
                  aria-label={
                    isCopied
                      ? `Copied "${w.word}"`
                      : `Copy "${w.word}" (${w.rarity}${
                          baseNote ? `, scored as its common form "${baseNote.base}"` : ""
                        }, guess ${i + 1})`
                  }
                >
                  {isBest && (
                    <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                      👑
                    </span>
                  )}
                  <span className="guess-log__word">{w.word}</span>
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
                  <span className="guess-log__entry-meta">
                    <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} />
                  </span>
                  {baseNote && (
                    // Already said in the button's aria-label, so the visible
                    // copy is decoration for a screen reader.
                    <span className="guess-log__base-note" aria-hidden="true">
                      Scored as its common form, “{baseNote.base}”
                    </span>
                  )}
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
