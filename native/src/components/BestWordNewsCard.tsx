import type { BestWordNewsKind } from '../../../src/game/bestWordNews';
import { formatRarityScore } from '../../../src/game/dictionary';
import { dropForDate } from '../../../src/game/drop';
import { handleFor } from '../../../src/game/handle';
import { finderTotal, otherPlayers } from '../../../src/game/yesterdaysBest';
import type { ResolvedBest } from '../../../src/hooks/useYesterdaysBest';
import { CelebrationCard, Highlight, Tally } from './CelebrationCard';
import { ConfettiBurst } from './ConfettiBurst';

/** The website's gold, hsl(45 92% 50%) for the ring and 38 92% 40% for the word. */
const GOLD = '45, 92%, 50%';
const GOLD_TEXT = 'hsl(38, 92%, 40%)';

/** "Ana", "Ana and Bo", "Ana and 3 other players". */
function finderNames(ids: readonly string[], total: number): string {
  if (total <= 1) return handleFor(ids[0]);
  if (total === 2 && ids.length >= 2) return `${handleFor(ids[0])} and ${handleFor(ids[1])}`;
  return `${handleFor(ids[0])} and ${otherPlayers(total - 1)}`;
}

/**
 * Yesterday's best word, announced over today's puzzle as the app opens (see
 * game/bestWordNews.ts): a celebration for a player who found it, and the news
 * of who did for everybody else -- a port of the website's BestWordNewsCard.
 *
 * The improving average's card, in gold: it floats over the puzzle and goes by
 * itself or on a tap.
 */
export function BestWordNewsCard({
  kind,
  resolved,
  onDone,
}: {
  kind: BestWordNewsKind;
  resolved: ResolvedBest;
  onDone: () => void;
}) {
  const { day, best, finderIds } = resolved;
  const ids = finderIds ?? [];
  const total = finderTotal(ids, best.finders);
  const score = formatRarityScore(best.zipf, best.foundOn || day);
  const drop = dropForDate(day);
  const word = <Highlight color={GOLD_TEXT}>{best.word}</Highlight>;
  const tally = <Tally>{score}</Tally>;

  return (
    <>
      {kind === 'self' && <ConfettiBurst rising />}
      <CelebrationCard
        accent={GOLD}
        icon={kind === 'self' ? '🏆' : '👑'}
        hop
        from="below"
        enterMs={520}
        title={kind === 'self' ? "You had yesterday's best word!" : "Yesterday's best word"}
        onDone={onDone}
      >
        {kind === 'self' ? (
          <>
            {word} scored {tally} on “{drop}”, the rarest find of the day.
          </>
        ) : (
          <>
            {finderNames(ids, total)} found {word}, scoring {tally} on “{drop}”.
          </>
        )}
      </CelebrationCard>
    </>
  );
}
