import { formatDateLabel } from '../../../src/game/date';
import { StepNav } from './StepNav';

interface Props {
  date: string;
  puzzleNumber: number;
  canGoToPrevious: boolean;
  canGoToNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * Which puzzle you are on, and the way back to the ones you missed.
 *
 * The arrows themselves are `StepNav`, shared with the boards and the finds
 * feed -- four screens that step through something, and the only differences
 * between them are the label and the noun.
 */
export function PuzzleNav({
  date,
  puzzleNumber,
  canGoToPrevious,
  canGoToNext,
  onPrevious,
  onNext,
}: Props) {
  return (
    <StepNav
      label={`Puzzle #${puzzleNumber} · ${formatDateLabel(date)}`}
      unit="puzzle"
      canGoBack={canGoToPrevious}
      canGoForward={canGoToNext}
      onBack={onPrevious}
      onForward={onNext}
    />
  );
}
