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
  /** This puzzle's one retry is still unspent and still reachable. */
  canRetry?: boolean;
  /** It has been spent, on a puzzle where it was offered in the first place. */
  retrySpent?: boolean;
  /**
   * Retries left on this puzzle, shown beside the guess count. Null when the
   * puzzle carries none, which is not the same as none left.
   */
  retriesLeft?: number | null;
  /** Drop a banked word and hand its guess back (see storage.retryWord). */
  onRetry?: (word: string) => void;
}

export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
  canRetry = false,
  retrySpent = false,
  retriesLeft = null,
  onRetry,
}: Props) {
  const best = bestWord(acceptedWords);
  const maxGuesses = maxGuessesFor(date);
  const guessesLeft = maxGuesses - acceptedWords.length;

  // Tap a logged word to copy it to the clipboard, flashing a brief confirmation.
  const [copiedWord, setCopiedWord] = useState<string | null>(null);
  // Armed by the retry button, and spent by tapping a word.
  //
  // Two taps rather than a retry control on every row: the log is four cards on
  // a phone, three of which are already carrying a crown, a copy affordance and
  // a rarity badge, and a fourth control per row would crowd the one thing the
  // card exists to show. Arming also gives the rule somewhere to be said at the
  // moment it applies -- once per day -- instead of a footnote nobody reads
  // until they have already spent it.
  const [arming, setArming] = useState(false);
  // Derived rather than cleared by hand: spending the retry flips `canRetry`,
  // and so does the day rolling over under a tab left open overnight.
  const picking = arming && canRetry;

  function retry(w: AcceptedWord) {
    setArming(false);
    onRetry?.(w.word);
  }

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
          {/* Both of the day's allowances, as matching chips: what you have
              left of each, counting down, named so neither number depends on
              its position to say what it is -- and said as "left", because
              these chips are now the only place the count appears and a bare
              "3 guesses" reads as easily as spent than remaining. The retry sits left of the guesses
              because it is the smaller, rarer one and reads as a modifier on
              them, and is absent entirely on a puzzle that carries none --
              which is a different thing from having none left. */}
          <span className="guess-log__meters">
            {retriesLeft !== null && (
              <span
                className={`guess-log__chip${
                  retriesLeft === 0 ? " guess-log__chip--spent" : ""
                }`}
              >
                {retriesLeft} retr{retriesLeft === 1 ? "y" : "ies"} left
              </span>
            )}
            <span
              className={`guess-log__chip${
                guessesLeft === 0 ? " guess-log__chip--spent" : ""
              }`}
            >
              {guessesLeft} guess{guessesLeft === 1 ? "" : "es"} left
            </span>
          </span>
        </div>
      )}

      {acceptedWords.length === 0 ? (
        // No instruction here any more. It read "enter a word below that
        // contains the drop", which is the submit form's own label one line
        // underneath -- and that one names the day's letters instead of saying
        // "the drop" to a player who may not have met the word yet. What an
        // empty slot is for is saying what will fill it.
        <p className="guess-log__empty">
          No words yet — every one you find lands here.
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
            // family, which may be a sibling ("abandoner" scores as
            // "abandoned") or a cousin reached through the chain ("precautioned"
            // as "caution"). 27,220 of the words carrying this note name
            // something that is not a base of theirs by any reading, and calling
            // a plural the base word of its own singular reads as the bug it is
            // meant to explain away.
            //
            // Words scored on a *longer* form get no note at all (see
            // baseFormRankDrop): naming a word the player would have had to
            // build up to reads as a correction of the find rather than an
            // explanation of the badge.
            const baseNote = baseFormRankDrop(w.word, date);
            return (
              <li
                key={w.word}
                className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}${
                  picking ? " guess-log__entry--picking" : ""
                }`}
              >
                {/* One button, two jobs. While the retry is armed the whole card
                    is the thing you tap to drop that word, which is why the
                    retry control could not simply live *inside* this button --
                    a button in a button is not markup a browser will render. */}
                <button
                  type="button"
                  className={`guess-log__entry-button${isCopied ? " guess-log__entry-button--copied" : ""}`}
                  onClick={() => (picking ? retry(w) : copyWord(w))}
                  aria-label={
                    picking
                      ? `Retry "${w.word}" (${w.rarity}, guess ${i + 1}) — clear it and try again`
                      : isCopied
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
                  {picking ? (
                    // Replaces the copy affordance rather than joining it: while
                    // the retry is armed, tapping this card does not copy.
                    <span className="guess-log__retry-hint" aria-hidden="true">
                      Retry
                    </span>
                  ) : isCopied ? (
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

      {/* Under the log rather than over it: the retry is about the words above
          it, and on a completed puzzle this is the only thing left to do. */}
      {(canRetry || retrySpent) && acceptedWords.length > 0 && (
        <div className={`guess-log__retry${picking ? " guess-log__retry--picking" : ""}`}>
          {picking ? (
            <>
              {/* role="status" so arming the retry announces the rule, which is
                  the one moment it matters and the only place it is said. */}
              <p className="guess-log__retry-prompt" role="status">
                Select a word to clear and try again. You can only do this once
                per day.
              </p>
              <button
                type="button"
                className="guess-log__retry-cancel"
                onClick={() => setArming(false)}
              >
                Never mind
              </button>
            </>
          ) : canRetry ? (
            <button
              type="button"
              className="guess-log__retry-button"
              onClick={() => setArming(true)}
            >
              <span aria-hidden="true">↺</span> Retry a word
            </button>
          ) : null}
        </div>
      )}

      {!completed && guessesLeft > 0 && acceptedWords.length > 0 && (
        <p className="guess-log__remaining">
          Aim for the highest rarity you can find.
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
