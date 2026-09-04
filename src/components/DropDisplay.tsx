import { useEffect, useMemo, useState } from "react";
import { formatDateLabel } from "../game/date";
import { definitionFor, formatRarityScore, learnableWordForDrop } from "../game/dictionary";
import { rarityClassName } from "./rarityStyles";

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
  /** Once the puzzle is done, the word itself drops in under the rarity badge. */
  completed?: boolean;
}

export function DropDisplay({ drop, date, isToday = true, completed = false }: Props) {
  // Recomputed only when the drop itself changes -- a full dictionary scan,
  // so it's not something we want re-running on unrelated re-renders.
  const reveal = useMemo(() => learnableWordForDrop(drop, date), [drop, date]);
  const definition = reveal ? definitionFor(reveal.word) : undefined;
  const [definitionOpen, setDefinitionOpen] = useState(false);

  // A new puzzle brings a new word, and the definition of the last one has no
  // business being open under it.
  useEffect(() => setDefinitionOpen(false), [drop, date]);

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
      {completed && reveal && (
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
