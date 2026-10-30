import { useEffect, useRef, useState, type ReactNode } from "react";
import { maxGuessesFor } from "../game/constants";
import { bestWord } from "../game/rank";
import { baseFormSubstitution, totalRarityScore } from "../game/dictionary";
import { raritySymbol } from "../game/share";
import { isNewBest } from "../game/celebration";
import { useWordDataLoaded } from "../hooks/useWordDataLoaded";
import { CommonFormModal } from "./CommonFormModal";
import { RarityBadge } from "./RarityBadge";
import { StreakDisplay } from "./StreakDisplay";
import type { AcceptedWord, StreakState } from "../game/types";
import { MODE_LABELS, type GameMode } from "../game/mode";
import type { CrossModePreview } from "../game/crossMode";

interface Props {
  acceptedWords: AcceptedWord[];
  completed?: boolean;
  streak?: StreakState;
  /** Puzzle date, so scores use the scoring system in effect that day. */
  date?: string;
  /**
   * Whether `date` is today's puzzle, for the streak shown once it is
   * finished: today's freeze state and the lazy weekend pie (see
   * StreakDisplay.tsx).
   */
  isToday?: boolean;
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
  /** Retries left, 2 while the week's do-over is held beside the puzzle's own (see game/doOver.ts). */
  retriesLeft?: number | null;
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
  /** The play screen's layout, which App.tsx always asks for. */
  newUi?: boolean;
  /** Sits in the header beside the count: the play screen's Share. */
  headerAction?: ReactNode;
}

/** How long a just-scored word keeps its "fresh" flourishes, in ms. */
const FRESH_MS = 2600;

export function GuessLog({
  acceptedWords,
  completed = false,
  streak,
  date,
  isToday = false,
  canRetry = false,
  retryOffered = false,
  retrySpent = false,
  retriesLeft = null,
  onRetry,
  otherMode,
  crossMode,
  copying = null,
  onCopyToOtherMode,
  newUi = false,
  headerAction,
}: Props) {
  const best = bestWord(acceptedWords);
  const maxGuesses = maxGuessesFor(date);
  // The common-form notes below are worked out from the deferred scoring data,
  // so they wait for it rather than name a base the reviewed folds overrule.
  const wordDataLoaded = useWordDataLoaded(date);
  const guessesLeft = maxGuesses - acceptedWords.length;

  // Armed by the retry button, and spent by tapping a word.
  //
  // Two taps rather than a retry control on every row: the log is four cards on
  // a phone, three of which are already carrying a crown and a rarity badge, and a fourth control per row would crowd the one thing the
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

  // New play screen: the word that has just landed, lit for a moment so the
  // eye finds it under the input. Only a word added while the log is on screen
  // -- not the words a puzzle loads with, or a puzzle switch.
  //
  // On either screen, the same word is also "fresh" for a little longer: its
  // badge pops in with its score rolling up, and if it beat the day's earlier
  // best it says so. A reward lands harder when it is seen arriving.
  const [landed, setLanded] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ word: string; newBest: boolean } | null>(null);
  const seen = useRef({ date, count: acceptedWords.length });
  useEffect(() => {
    const before = seen.current;
    seen.current = { date, count: acceptedWords.length };
    if (before.date !== date || acceptedWords.length <= before.count) return;
    const word = acceptedWords[acceptedWords.length - 1].word;
    setFresh({ word, newBest: isNewBest(acceptedWords) });
    if (newUi) setLanded(word);
    const landedTimer = window.setTimeout(() => setLanded((w) => (w === word ? null : w)), 1600);
    const freshTimer = window.setTimeout(
      () => setFresh((f) => (f?.word === word ? null : f)),
      FRESH_MS,
    );
    return () => {
      window.clearTimeout(landedTimer);
      window.clearTimeout(freshTimer);
    };
  }, [acceptedWords, date, newUi]);

  // New play screen: the per-word "Submit to <other mode>" controls stay
  // folded behind one line under the log, so a card carries the word and its
  // score and not a link to a game a new player may not know exists.
  const [offeringOther, setOfferingOther] = useState(false);
  const anyReady =
    otherMode !== undefined &&
    acceptedWords.some((w) => crossMode?.[w.word]?.state === "ready");

  function retry(w: AcceptedWord) {
    setArming(false);
    onRetry?.(w.word);
  }

  return (
    <section className={`guess-log${completed ? " guess-log--completed" : ""}`} aria-label="Your guesses">
      {/* Gone on a finished puzzle, except on the new play screen, where the
          Share beside the count is how the share panel is reached -- and a
          finished puzzle is the likeliest moment to want it. */}
      {(!completed || newUi) && (
        <div className="guess-log__header">
          {/* No mode named here: the header's switch already says which game
              this is. */}
          <h2 className="guess-log__title">Guesses</h2>
          {/* Guesses only. The retry used to sit here too, as a second "X of
              Y" beside this one -- but it is a single yes/no reserve, not a
              running tally, and pairing it with a real multi-step count made
              it read as the same kind of number when it isn't. That state now
              lives on the retry control itself, below: the button *is* the
              indicator, available or spent, no fraction required. */}
          <span className="guess-log__count">
            {acceptedWords.length} of {maxGuesses} guesses
          </span>
          {headerAction}
        </div>
      )}

      {acceptedWords.length === 0 ? (
        // No instruction here any more. It read "enter a word below that
        // contains the drop", which is the submit form's own label one line
        // underneath -- and that one names the day's letters instead of saying
        // "the drop" to a player who may not have met the word yet. What an
        // empty slot is for is saying what will fill it.
        <p className="guess-log__empty">
          {newUi
            ? "No words yet — aim for the rarest word you can find."
            : "No words yet — every one you find lands here."}
        </p>
      ) : (
        <ol className="guess-log__list">
          {acceptedWords.map((w, i) => {
            const isBest = best !== undefined && w.word === best.word;
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
            const baseNote = wordDataLoaded ? baseFormSubstitution(w.word, date) : undefined;
            const elsewhere = otherMode ? crossMode?.[w.word] : undefined;
            const isFresh = fresh?.word === w.word;
            return (
              <li
                key={w.word}
                className={`guess-log__entry${isBest ? " guess-log__entry--best" : ""}${
                  picking ? " guess-log__entry--picking" : ""
                }${landed === w.word ? " guess-log__entry--landed" : ""}${
                  isFresh && fresh?.newBest ? " guess-log__entry--new-best" : ""
                }`}
              >
                {/* The card is a button only while the retry is armed, when
                    tapping it drops that word. It used to copy the word to the
                    clipboard the rest of the time, which nobody used. The
                    retry control cannot live *inside* this button: a button in
                    a button is not markup a browser will render. */}
                {picking ? (
                  <button
                    type="button"
                    className="guess-log__entry-button"
                    onClick={() => retry(w)}
                    aria-label={`Retry "${w.word}" (${w.rarity}, guess ${i + 1}) — clear it and try again`}
                  >
                    {isBest && (
                      <span className="guess-log__crown" aria-hidden="true" title="Your best word so far">
                        👑
                      </span>
                    )}
                    <span className="guess-log__word">{w.word}</span>
                    <span className="guess-log__retry-hint" aria-hidden="true">
                      Retry
                    </span>
                    <span className="guess-log__entry-meta">
                      <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} />
                    </span>
                  </button>
                ) : (
                  <div className="guess-log__entry-button guess-log__entry-button--static">
                    {isBest && (
                      <span className="guess-log__crown" role="img" aria-label="Best word" title="Your best word so far">
                        👑
                      </span>
                    )}
                    <span className="guess-log__word">{w.word}</span>
                    {isFresh && fresh?.newBest && (
                      <span className="guess-log__new-best">New best!</span>
                    )}
                    <span className="guess-log__entry-meta">
                      <RarityBadge rarity={w.rarity} zipf={w.zipf} date={date} fresh={isFresh} />
                    </span>
                  </div>
                )}
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
                    {/* Read in place: the card above is plain text now, with no
                        label of its own to carry this. The control beside it
                        has a label naming the word it is about. */}
                    <span>Scored as its common form, “{baseNote.base}”</span>
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
                {elsewhere && otherMode && !picking &&
                  (!newUi || offeringOther || elsewhere.state === "copied") && (
                  <OtherModeRow
                    word={w.word}
                    mode={otherMode}
                    preview={elsewhere}
                    copying={copying}
                    onCopy={onCopyToOtherMode}
                    date={date}
                    newUi={newUi}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {newUi && anyReady && otherMode && !picking && (
        <p className="guess-log__other-offer">
          <button
            type="button"
            className="guess-log__other-offer-button"
            aria-expanded={offeringOther}
            onClick={() => setOfferingOther((was) => !was)}
          >
            {offeringOther
              ? `Hide ${MODE_LABELS[otherMode]} options`
              : `Also play these words in ${MODE_LABELS[otherMode]} mode`}
          </button>
        </p>
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
              aria-label={retriesLeft !== null && retriesLeft > 1 ? `Retry 1 word, ${retriesLeft} retries left` : undefined}
            >
              <span aria-hidden="true">↺</span>{" "}
              {retriesLeft !== null && retriesLeft > 1 ? `${retriesLeft} retries` : "Retry 1 word"}
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

      {!newUi && !completed && guessesLeft > 0 && acceptedWords.length > 0 && (
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
            date={date}
            isToday={isToday}
            hideEmpty={newUi}
            hasWords={acceptedWords.length > 0}
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
  newUi = false,
}: {
  word: string;
  mode: GameMode;
  date?: string;
  preview: CrossModePreview;
  copying: string | null;
  onCopy?: (word: string) => void;
  /** The new play screen words it as playing, not submitting. */
  newUi?: boolean;
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
          {copying === word
            ? newUi
              ? "Playing…"
              : "Submitting…"
            : newUi
              ? `Play in ${label}`
              : `Submit to ${label}`}
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

