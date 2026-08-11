import { formatDateLabel } from "../game/date";

interface Props {
  date: string;
  puzzleNumber: number;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function PuzzleNav({
  date,
  puzzleNumber,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
}: Props) {
  return (
    <div className="puzzle-nav">
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
      <p className="app__puzzle-number" aria-live="polite">
        Puzzle #{puzzleNumber} · {formatDateLabel(date)}
      </p>
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
