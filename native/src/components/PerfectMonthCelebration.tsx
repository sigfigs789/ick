import { perfectMonthName } from '../../../src/game/perfectMonth';
import { CelebrationCard, Tally } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';

/** The perfect month's gold, hsl(42 88% 52%). */
const GOLD = '42, 88%, 52%';

/**
 * The moment a player finishes a month without missing a day.
 *
 * Bigger than the Rare-word burst on purpose -- that one fires most days, and
 * this one at most twelve times a year -- so it brings the grand gold confetti
 * and a card naming the month. The card floats over the puzzle rather than
 * taking it over: the player is mid-guess on the last day, and a modal they had
 * to close before their next word would be a celebration in the way.
 */
export function PerfectMonthCelebration({
  date,
  days,
  onDone,
}: {
  date: string;
  days: number;
  onDone: () => void;
}) {
  const month = perfectMonthName(date);
  return (
    <>
      <ConfettiBurst grand />
      <CelebrationCard
        accent={GOLD}
        icon="🏆"
        from="above"
        enterMs={420}
        title={`Perfect ${month}!`}
        onDone={onDone}
      >
        You played every puzzle this month —{' '}
        <Tally>{`${days} for ${days}`}</Tally>.
      </CelebrationCard>
    </>
  );
}
