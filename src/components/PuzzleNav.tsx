import { formatDateLabel } from "../game/date";

interface Props {
  date: string;
  puzzleNumber: number;
  isToday: boolean;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function PuzzleNav({
  date,
  puzzleNumber,
  isToday,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
  onToday,
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
        ‹
      </button>
      <p className="app__puzzle-number" aria-live="polite">
        Puzzle #{puzzleNumber} · {formatDateLabel(date)}
        {!isToday && <span className="puzzle-nav__archive-tag"> (archive)</span>}
      </p>
      <button
        type="button"
        className="puzzle-nav__arrow"
        onClick={onNext}
        disabled={!canGoToNext}
        aria-label="Next puzzle"
      >
        ›
      </button>
      {!isToday && (
        <button type="button" className="puzzle-nav__today" onClick={onToday}>
          Back to today
        </button>
      )}
    </div>
  );
}
