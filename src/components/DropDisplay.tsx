import { useEffect, useMemo, useState } from "react";
import { formatDateLabel } from "../game/date";
import { definitionFor, formatRarityScore, learnableWordForDrop } from "../game/dictionary";
import { rarityClassName } from "./rarityStyles";
import { revealGatedFor } from "../game/constants";
import { RevealWordModal } from "./RevealWordModal";

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
  /** Once the puzzle is done, the word itself drops in under the rarity badge. */
  completed?: boolean;
  /**
   * The puzzle's retry is still unspent, which is what makes the reveal cost
   * something: a finished puzzle can be re-opened by retrying a word (see
   * storage.retryWord), so handing the word over first would turn the mulligan
   * into a lookup. With no retry on offer the button still guards the word --
   * it just asks instead of charging.
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
  // Asked for and shown. Held here rather than in storage: it is a fact about
  // this sitting, not about the puzzle, and the one thing the reveal does spend
  // -- the retry -- is saved where every other puzzle fact is.
  const [revealed, setRevealed] = useState(false);

  // Only from REVEAL_GATE_START: puzzles that printed their word the moment the
  // last guess landed keep doing so, however far back a player browses.
  const hidden = revealGatedFor(date) && !revealed;
  // The retry is the price, and it exists on the current puzzle only. An
  // archive day still hides its word, but the button there only has to be
  // pressed -- there is nothing left to charge (see useDailyPuzzle.retryOffered).
  const costsRetry = retryOffered && onReveal !== undefined;

  // A new puzzle brings a new word, and its definition starts open the same way
  // the first one did -- not left closed by a click aimed at the last word.
  useEffect(() => setDefinitionOpen(true), [drop, date]);

  // A new puzzle hides its own word again, with nothing left to confirm.
  useEffect(() => {
    setConfirmingReveal(false);
    setRevealed(false);
  }, [drop, date]);

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
            onClick={() => (costsRetry ? setConfirmingReveal(true) : setRevealed(true))}
          >
            Word of the day
          </button>
          {/* The cost is said before the button is pressed as well as in the
              modal: a player deciding whether to tap should not have to tap to
              find out what it costs. Nothing is said when nothing is charged. */}
          {costsRetry && <p className="drop-display__reveal-cost">Uses your retry</p>}
          <RevealWordModal
            open={confirmingReveal}
            onConfirm={() => {
              setConfirmingReveal(false);
              setRevealed(true);
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
