import { useMemo, useState } from "react";
import { formatDateLabel } from "../game/date";
import { hintForDrop } from "../game/hints";

interface Props {
  drop: string;
  date?: string;
  isToday?: boolean;
  /** Once the puzzle is done there is nothing left to hint at. */
  completed?: boolean;
}

export function DropDisplay({ drop, date, isToday = true, completed = false }: Props) {
  const hint = useMemo(() => hintForDrop(drop), [drop]);
  const [revealed, setRevealed] = useState(false);

  // Only while there are still guesses to spend: a hint teaches a way to look
  // for words, which is no use to someone who has finished looking. Not every
  // drop has one -- see hintForDrop -- and a drop without one shows no button,
  // which says there is no trick today rather than inventing one.
  const showHint = !completed && hint !== undefined;

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
      <p className="drop-display__ceiling">
        Best possible score: 10.0
      </p>
      {showHint &&
        (revealed ? (
          <p className="drop-display__hint" role="status">
            {hint}
          </p>
        ) : (
          <button
            type="button"
            className="drop-display__hint-button"
            onClick={() => setRevealed(true)}
          >
            See hint
          </button>
        ))}
    </div>
  );
}
