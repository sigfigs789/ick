import { CelebrationCard, Highlight, Tally } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';

/** The streak's orange, as the climb's card wears it. */
const ORANGE = '24, 90%, 52%';
const ORANGE_TEXT = 'hsl(24, 90%, 44%)';

/**
 * The day the streak first goes past the player's longest before it (see
 * game/newBest.ts), on the submission that takes it there -- a port of the
 * website's NewBestCelebration.
 *
 * The streak climb's card, flame and all: it floats over the puzzle and goes
 * by itself or on a tap.
 */
export function NewBestCelebration({
  days,
  best,
  onDone,
}: {
  days: number;
  best: number;
  onDone: () => void;
}) {
  return (
    <>
      <ConfettiBurst rising />
      <CelebrationCard
        accent={ORANGE}
        icon="🔥"
        hop
        from="below"
        enterMs={520}
        title="Your longest streak yet!"
        onDone={onDone}
      >
        <Highlight color={ORANGE_TEXT}>{days} days</Highlight> — past your best of{' '}
        <Tally>{best}</Tally>.
      </CelebrationCard>
    </>
  );
}
