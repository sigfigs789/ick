import type { ReactNode } from "react";
import { formatDateLabel } from "../game/date";

interface Props {
  date: string;
  puzzleNumber: number;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /**
   * What sits between the arrows. The game puts the drop itself there, which
   * already names the day; without it, the puzzle number and date stand in.
   */
  children?: ReactNode;
}

export function PuzzleNav({
  date,
  puzzleNumber,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
  children,
}: Props) {
  return (
    <div className={children ? "puzzle-nav puzzle-nav--drop" : "puzzle-nav"}>
      <button
        type="button"
        className="puzzle-nav__arrow"
        onClick={onPrevious}
        disabled={!canGoToPrevious}
        aria-label="Previous puzzle"
      >
        <span aria-hidden="true">‹</span>
        <span>Previous</span>
      </button>
      {children ?? (
        <p className="app__puzzle-number" aria-live="polite">
          Puzzle #{puzzleNumber} · {formatDateLabel(date)}
        </p>
      )}
      <button
        type="button"
        className="puzzle-nav__arrow"
        onClick={onNext}
        disabled={!canGoToNext}
        aria-label="Next puzzle"
      >
        <span>Next</span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
