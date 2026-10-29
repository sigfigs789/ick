import { CelebrationCard, Highlight } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';
import { signalTap } from '../host/feedback';

/** The website's gold, hsl(45 92% 50%) for the ring, 38 92% 40% for the place and 36% for the link. */
const GOLD = '45, 92%, 50%';
const GOLD_TEXT = 'hsl(38, 92%, 40%)';
const GOLD_LINK = 'hsl(38, 92%, 36%)';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * A place in the top three of today's board (see game/topRank.ts) -- a port of
 * the website's TopRankCelebration.
 *
 * The climb's card, in yesterday's-best gold, with the medal for the place and
 * a way to the board itself, which takes the card with it. It lands a moment
 * after the finish and goes by itself or on a tap.
 */
export function TopRankCelebration({
  rank,
  onSeeBoard,
  onDone,
}: {
  rank: number;
  /** Opens the Leaderboards tab. */
  onSeeBoard: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <ConfettiBurst rising />
      <CelebrationCard
        accent={GOLD}
        icon={MEDALS[rank - 1]}
        hop
        from="below"
        enterMs={520}
        title={rank === 1 ? '#1 today!' : 'Top 3 today!'}
        link={{
          label: 'See the leaderboard',
          color: GOLD_LINK,
          onPress: () => {
            signalTap();
            onDone();
            onSeeBoard();
          },
        }}
        onDone={onDone}
      >
        You're <Highlight color={GOLD_TEXT}>#{rank}</Highlight> on today's board.
      </CelebrationCard>
    </>
  );
}
