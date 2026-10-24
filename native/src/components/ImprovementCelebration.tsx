import { formatTotal } from '../../../src/game/dictionary';
import { improvementPercent, type Improvement } from '../../../src/game/improvement';
import { CelebrationCard, Highlight, Tally } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';

/** The website's green, hsl(140 58% 42%) for the ring and 38% for the gain. */
const GREEN = '140, 58%, 42%';
const GREEN_TEXT = 'hsl(140, 58%, 38%)';

/**
 * The moment a finished puzzle shows the player's average climbing (see
 * game/improvement.ts).
 *
 * The perfect month's card, in green and with an arrow rather than a trophy,
 * over a burst that goes up rather than down, like the average did. It lands
 * when the day is done, so it floats over a finished puzzle rather than in the
 * way of a guess, and goes by itself or on a tap.
 */
export function ImprovementCelebration({
  improvement,
  onDone,
}: {
  improvement: Improvement;
  onDone: () => void;
}) {
  const { recent, earlier, days } = improvement;
  return (
    <>
      <ConfettiBurst rising />
      <CelebrationCard
        accent={GREEN}
        icon="📈"
        hop
        from="below"
        enterMs={520}
        title="You're on the rise!"
        onDone={onDone}
      >
        Your average over your last {days} puzzles is up{' '}
        <Highlight color={GREEN_TEXT}>{improvementPercent(improvement)}%</Highlight> —{' '}
        {/* Non-breaking, so the before-and-after never splits across lines. */}
        <Tally>{`${formatTotal(earlier)} → ${formatTotal(recent)}`}</Tally>.
      </CelebrationCard>
    </>
  );
}
