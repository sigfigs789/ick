import type { StreakClimb } from '../../../src/game/streakClimb';
import { CelebrationCard, Highlight, Tally } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';

/** The streak's orange, hsl(24 90% 52%) for the ring and 44% for the gain. */
const ORANGE = '24, 90%, 52%';
const ORANGE_TEXT = 'hsl(24, 90%, 44%)';

/**
 * The moment a finished puzzle moves the player up the streak board (see
 * game/streakClimb.ts).
 *
 * The improving average's card, in the streak's orange and with its flame: it
 * lands when the day is done, floats over the finished puzzle, and goes by
 * itself or on a tap.
 */
export function StreakClimbCelebration({
  climb,
  onDone,
}: {
  climb: StreakClimb;
  onDone: () => void;
}) {
  const { from, to } = climb;
  const places = from - to;
  return (
    <>
      <ConfettiBurst rising />
      <CelebrationCard
        accent={ORANGE}
        icon="🔥"
        hop
        from="below"
        enterMs={520}
        title={to === 1 ? 'Top of the streak board!' : 'Up the streak board!'}
        onDone={onDone}
      >
        You've climbed{' '}
        <Highlight color={ORANGE_TEXT}>
          {places} {places === 1 ? 'place' : 'places'}
        </Highlight>{' '}
        — <Tally>{`#${from} → #${to}`}</Tally>.
      </CelebrationCard>
    </>
  );
}
