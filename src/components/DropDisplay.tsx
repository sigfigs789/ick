import { useEffect, useMemo, useState } from "react";
import { formatDateLabel } from "../game/date";
import { definitionFor, formatRarityScore, learnableWordForDrop } from "../game/dictionary";
import { rarityClassName } from "./rarityStyles";
import { RevealWordModal } from "./RevealWordModal";

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
  /** Once the puzzle is done, the word itself drops in under the rarity badge. */
  completed?: boolean;
  /**
   * The puzzle's retry is still unspent. While it is, the word stays behind a
   * "Reveal word" button: a finished puzzle can be re-opened by retrying a
   * word (see storage.retryWord), so handing over the best word first would
   * turn the mulligan into a lookup.
   */
  retryOffered?: boolean;
  /** Spend the retry to see the word (see useDailyPuzzle.revealAnswer). */
  onReveal?: () => void;
}

export function DropDisplay({
  drop,
  date,
  isToday = true,
  completed = false,
  retryOffered = false,
  onReveal,
}: Props) {
  // Recomputed only when the drop itself changes -- a full dictionary scan,
  // so it's not something we want re-running on unrelated re-renders.
  const reveal = useMemo(() => learnableWordForDrop(drop, date), [drop, date]);
  const definition = reveal ? definitionFor(reveal.word) : undefined;
  // Open by default: the definition is the point of the reveal, so it should be
  // there to read without asking. The toggle stays for anyone who wants it gone.
  const [definitionOpen, setDefinitionOpen] = useState(true);

  // Armed by the reveal button, and cleared either way by answering it.
  const [confirmingReveal, setConfirmingReveal] = useState(false);

  // The gate is the retry itself, not a "revealed" flag of its own: spending
  // it is what opens the word, so a reload finds the same answer showing.
  const hidden = retryOffered && onReveal !== undefined;

  // A new puzzle brings a new word, and its definition starts open the same way
  // the first one did -- not left closed by a click aimed at the last word.
  useEffect(() => setDefinitionOpen(true), [drop, date]);

  // Nothing left to confirm once the puzzle -- or the retry -- has moved on.
  useEffect(() => setConfirmingReveal(false), [drop, date, hidden]);

  return (
    <div className="drop-display">
      <p className="drop-display__label" id="drop-label">
        {!isToday && date ? `${formatDateLabel(date)}'s drop` : "Today's drop"}
      </p>
      <p className="drop-display__value" aria-labelledby="drop-label">
        {drop.split("").map((ch, i) => (
          <span className="drop-display__letter" key={i}>
            {ch}
          </span>
        ))}
      </p>
      {reveal && (
        <p className="drop-display__ceiling">
          Best possible score: 10.0
        </p>
      )}
      {completed && reveal && hidden && (
        <div className="drop-display__reveal">
          <button
            type="button"
            className="drop-display__reveal-button"
            onClick={() => setConfirmingReveal(true)}
          >
            Reveal word
          </button>
          {/* The cost is said before the button is pressed as well as in the
              modal: a player deciding whether to tap should not have to tap to
              find out what it costs. */}
          <p className="drop-display__reveal-cost">Uses your retry</p>
          <RevealWordModal
            open={confirmingReveal}
            onConfirm={() => {
              setConfirmingReveal(false);
              onReveal?.();
            }}
            onClose={() => setConfirmingReveal(false)}
          />
        </div>
      )}
      {completed && reveal && !hidden && (
        <div className="drop-display__reveal">
          {definition ? (
            <button
              type="button"
              className="drop-display__ceiling-word drop-display__ceiling-word--toggle"
              aria-expanded={definitionOpen}
              onClick={() => setDefinitionOpen((wasOpen) => !wasOpen)}
            >
              {reveal.word}
              {/* The score alone, wearing its tier's colours -- the badge's tag
                  and dot would cost more room than the reveal is worth. The
                  tier is named for a screen reader, so nothing rests on the
                  colour by itself. */}
              <span
                className={`drop-display__ceiling-word-score ${rarityClassName(reveal.rarity, date)}`}
              >
                {formatRarityScore(reveal.zipf, date)}
                <span className="sr-only"> {reveal.rarity}</span>
              </span>
              {/* The caret says "there is more here" to the eye; the button's
                  aria-expanded says it to a reader, so the glyph stays silent. */}
              <span className="drop-display__reveal-caret" aria-hidden="true">
                {definitionOpen ? "▴" : "▾"}
              </span>
            </button>
          ) : (
            <p className="drop-display__ceiling-word">
              {reveal.word}
              {/* The score alone, wearing its tier's colours -- the badge's tag
                  and dot would cost more room than the reveal is worth. The
                  tier is named for a screen reader, so nothing rests on the
                  colour by itself. */}
              <span
                className={`drop-display__ceiling-word-score ${rarityClassName(reveal.rarity, date)}`}
              >
                {formatRarityScore(reveal.zipf, date)}
                <span className="sr-only"> {reveal.rarity}</span>
              </span>
            </p>
          )}
          {/* Always in the reading order, shown or not: it is one short line,
              and a screen reader that had to press the button to hear it would
              be worse served than the eye that can see the caret. */}
          {definition && (
            <p className={`drop-display__definition${definitionOpen ? "" : " sr-only"}`}>
              {definition}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
