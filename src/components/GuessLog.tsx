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
import { CommonFormModal } from "./CommonFormModal";
import { RainbowWord } from "./RainbowWord";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";
import { MODE_LABELS, type GameMode } from "../game/mode";
import type { CrossModePreview } from "../game/crossMode";

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
  /** This puzzle's one retry is still unspent and there is a word to spend it on. */
  canRetry?: boolean;
  /**
   * This puzzle's one retry is still unspent, whether or not there is
   * anything to retry yet. Shows the control from the moment the puzzle
   * opens -- greyed out until `canRetry` -- rather than having it appear out
   * of nowhere once the first word lands.
   */
  retryOffered?: boolean;
  /** It has been spent, on a puzzle where it was offered in the first place. */
  retrySpent?: boolean;
  /** Drop a banked word and hand its guess back (see storage.retryWord). */
  onRetry?: (word: string) => void;
  /** The mode the player is not in, which each word can be copied into. */
  otherMode?: GameMode;
  /**
   * Where each word stands in `otherMode`, keyed by word (see
   * game/crossMode.ts). Its score there is shown only once it is submitted.
   * Absent or empty on a puzzle with only one game.
   */
  crossMode?: Record<string, CrossModePreview>;
  /** The word being submitted right now, while its lookup or write runs. */
  copying?: string | null;
  /** Submit a word to `otherMode` as well. */
  onCopyToOtherMode?: (word: string) => void;
  /**
   * The mode this log belongs to, named in its heading. Absent on a puzzle the
   * switch does not decide (see `modeIsChosen`), which has only the one game.
   */
  mode?: GameMode;
}

export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
  canRetry = false,
  retryOffered = false,
  retrySpent = false,
  onRetry,
  otherMode,
  crossMode,
  copying = null,
  onCopyToOtherMode,
  mode,
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
  // The word whose common-form note has its panel open, or null. The word
  // rather than a boolean: the panel leads with the pair it was opened from,
  // and a log can carry several notes at once.
  const [explaining, setExplaining] = useState<{ word: string; base: string } | null>(null);
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
      {/* Kept on a finished puzzle when there is a mode to name: the log is
          still one of two, and the other mode's game is a tap away. The count
          is what a finished puzzle has no use for. */}
      {(!completed || mode) && (
        <div className="guess-log__header">
          <h2 className="guess-log__title">
            {/* Styled as the header's switch is -- Freeform's name in rainbow
                letters, Standard's plain -- so the two read as one signal, and
                named here because this is where the eye is while playing. */}
            {mode && (
              <span className={`guess-log__mode guess-log__mode--${mode}`}>
                {mode === "freeform" ? (
                  // The word once for a screen reader, and the rainbow -- one
                  // span per letter -- kept out of its way.
                  <>
                    <span className="sr-only">{MODE_LABELS[mode]}</span>
                    <span aria-hidden="true">
                      <RainbowWord word={MODE_LABELS[mode]} />
                    </span>
                  </>
                ) : (
                  MODE_LABELS[mode]
                )}
              </span>
            )}
            {mode ? "guess log" : "Guess log"}
          </h2>
          {/* Guesses only. The retry used to sit here too, as a second "X of
              Y" beside this one -- but it is a single yes/no reserve, not a
              running tally, and pairing it with a real multi-step count made
              it read as the same kind of number when it isn't. That state now
              lives on the retry control itself, below: the button *is* the
              indicator, available or spent, no fraction required. */}
          {!completed && (
            <span className="guess-log__count">
              {acceptedWords.length} of {maxGuesses} guesses
            </span>
          )}
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
            // Shown for every word scored as another form, whatever it cost.
            // With two modes one switch apart, the same word reads at two
            // prices, and a Standard score with no note beside it looks like a
            // bug the moment the player has seen it in Freeform. It used to be
            // kept for a lost rank of at least 0.3 points, and never shown for
            // a longer form ("titty" as "titties") -- which left exactly those
            // drops unexplained.
            //
            // "common form" rather than "base word", because the fold does not
            // only run toward bases. It takes the most common word in the
            // family, which may be a sibling ("abandoner" scores as
            // "abandoned"), a cousin reached through the chain ("precautioned"
            // as "caution"), or a longer form ("abaci" as "abacus"), and calling
            // a plural the base word of its own singular reads as the bug it is
            // meant to explain away.
            const baseNote = baseFormSubstitution(w.word, date);
            const elsewhere = otherMode ? crossMode?.[w.word] : undefined;
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
                </button>
                {/* Outside the card's button rather than in it, which is what
                    the "More info" control costs: a button cannot contain
                    another one, and the note is the only thing on the card
                    with a second thing to say. It keeps the card's row-two
                    position and indent, so the move is invisible.

                    Hidden while the retry is armed: the whole card is the
                    thing you tap then, and a live control sitting in it is a
                    hole in that target. */}
                {baseNote && !picking && (
                  <p className="guess-log__base-note">
                    {/* The text is already in the button's aria-label above,
                        so the visible copy stays out of the reading order --
                        but the control beside it must not, hence a label of
                        its own that names the word it is about. */}
                    <span aria-hidden="true">
                      Scored as its common form, “{baseNote.base}”
                    </span>
                    <button
                      type="button"
                      className="guess-log__base-note-info"
                      onClick={() => setExplaining({ word: w.word, base: baseNote.base })}
                      aria-label={`Why “${w.word}” was scored as its common form “${baseNote.base}”`}
                    >
                      More info
                    </button>
                  </p>
                )}
                {/* The control that submits the same word to the other mode,
                    and once it has, what it scored there -- so a player does
                    not have to flip the switch to find out.
                    A sibling of the card for the same reason the note above
                    is, and hidden while the retry is armed for the same reason
                    too. */}
                {elsewhere && otherMode && !picking && (
                  <OtherModeRow
                    word={w.word}
                    mode={otherMode}
                    preview={elsewhere}
                    copying={copying}
                    onCopy={onCopyToOtherMode}
                    date={date}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Under the log rather than over it: the retry is about the words above
          it, and on a completed puzzle this is the only thing left to do.

          Shown from the moment the puzzle opens (retryOffered), not only once
          there is a word to spend it on (canRetry) -- the button starts
          greyed out rather than appearing out of nowhere the instant a first
          guess lands. */}
      {(retryOffered || retrySpent) && (
        <div className={`guess-log__retry${picking ? " guess-log__retry--picking" : ""}`}>
          {picking ? (
            <>
              {/* role="status" so arming the retry announces what it does. The
                  limit itself is said below, before this is ever reached --
                  no need to repeat it here too. */}
              <p className="guess-log__retry-prompt" role="status">
                Select a word to clear and try again.
              </p>
              <button
                type="button"
                className="guess-log__retry-cancel"
                onClick={() => setArming(false)}
              >
                Never mind
              </button>
            </>
          ) : retryOffered ? (
            // The limit is in the label itself now -- "1 word", not "a word"
            // -- so it doesn't need a separate caption underneath to say the
            // same thing a second way.
            <button
              type="button"
              className="guess-log__retry-button"
              disabled={!canRetry}
              title={canRetry ? undefined : "Guess a word first"}
              onClick={() => setArming(true)}
            >
              <span aria-hidden="true">↺</span> Retry 1 word
            </button>
          ) : (
            // Spent: the button is gone (there is nothing left to arm), but a
            // returning player should still see what happened to it rather
            // than finding it silently missing. Same spot, same icon, just
            // inert -- the control's own memory of itself.
            <p className="guess-log__retry-spent">
              <span aria-hidden="true">↺</span> Retry used
            </p>
          )}
        </div>
      )}

      {!completed && guessesLeft > 0 && acceptedWords.length > 0 && (
        <p className="guess-log__remaining">
          Aim for the highest rarity you can find.
        </p>
      )}

      <CommonFormModal
        word={explaining ?? undefined}
        date={date}
        onClose={() => setExplaining(null)}
      />

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

/**
 * One word's line about the other mode: the control that submits it there, or
 * once it has been, what it scored.
 *
 * The score over there is held back until the word is submitted. Showing it up
 * front would turn the other mode into a free price check -- try every word in
 * one game, then spend the other game's guesses only on the ones that pay --
 * and a submission should cost the same blind guess it would cost typed.
 */
function OtherModeRow({
  word,
  mode,
  preview,
  copying,
  onCopy,
  date,
}: {
  word: string;
  mode: GameMode;
  date?: string;
  preview: CrossModePreview;
  copying: string | null;
  onCopy?: (word: string) => void;
}) {
  const label = MODE_LABELS[mode];
  return (
    <p className={`guess-log__other-mode guess-log__other-mode--${preview.state}`}>
      {preview.state === "ready" && (
        <button
          type="button"
          className="guess-log__other-mode-copy"
          disabled={copying !== null || !onCopy}
          onClick={() => onCopy?.(word)}
          aria-label={`Submit “${word}” to ${label}. Uses one ${label} guess.`}
        >
          {copying === word ? "Submitting…" : `Submit to ${label}`}
        </button>
      )}
      {preview.state === "copied" && (
        <span className="guess-log__other-mode-score">
          {/* The mode is named once, in the lead-in: a "Freeform:" prefix on
              the score as well read as the same word twice in one short line.
              The check says the word is over there; the words say what the
              number after them is. */}
          <span className="guess-log__other-mode-done">
            <span aria-hidden="true">✓</span> Its score in {label}:
          </span>{" "}
          <strong>{preview.score}</strong>{" "}
          {/* The tier's square from the share text, so the word reads the
              same here as it will when pasted. */}
          <span aria-hidden="true">{raritySymbol(preview.word.rarity, date)}</span> {preview.word.rarity}
        </span>
      )}
      {preview.state === "refused" && <span>Not playable in {label}</span>}
      {preview.state === "full" && <span>{label} game finished</span>}
    </p>
  );
}
