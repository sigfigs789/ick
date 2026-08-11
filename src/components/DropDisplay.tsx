import { useMemo } from "react";
import { bestWordForDrop, rarityScore } from "../game/dictionary";

interface Props {
  drop: string;
  /** Once the puzzle is done, the word itself drops in under the rarity badge. */
  completed?: boolean;
}

export function DropDisplay({ drop, completed = false }: Props) {
  // Recomputed only when the drop itself changes -- a full dictionary scan,
  // so it's not something we want re-running on unrelated re-renders.
  const best = useMemo(() => bestWordForDrop(drop), [drop]);

  return (
    <div className="drop-display">
      <p className="drop-display__label" id="drop-label">
        Today's ink
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
          Best possible: {rarityScore(best.zipf).toFixed(1)}
        </p>
      )}
      {completed && best && (
        <p className="drop-display__ceiling-word">{best.word}</p>
      )}
    </div>
  );
}
