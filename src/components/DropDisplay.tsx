import { useMemo } from "react";
import { formatDateLabel } from "../game/date";
import { bestWordForDrop, rarityScore } from "../game/dictionary";

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
  const best = useMemo(() => bestWordForDrop(drop), [drop]);

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
      {best && (
        <p className="drop-display__ceiling">
          Best possible score: {rarityScore(best.zipf).toFixed(1)}
        </p>
      )}
      {completed && best && (
        <p className="drop-display__ceiling-word">{best.word}</p>
      )}
    </div>
  );
}
