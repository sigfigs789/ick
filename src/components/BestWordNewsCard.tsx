import { useEffect } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { formatRarityScore } from "../game/dictionary";
import { dropForDate } from "../game/drop";
import { handleFor } from "../game/handle";
import type { BestWordNewsKind } from "../game/bestWordNews";
import { finderTotal, otherPlayers } from "../game/yesterdaysBest";
import type { ResolvedBest } from "../hooks/useYesterdaysBest";

/** How long the card stays up if nobody taps it, as the improving average's does. */
const CELEBRATION_MS = 7000;

/** "Ana", "Ana and Bo", "Ana and 3 other players". */
function finderNames(ids: readonly string[], total: number): string {
  if (total <= 1) return handleFor(ids[0]);
  if (total === 2 && ids.length >= 2) return `${handleFor(ids[0])} and ${handleFor(ids[1])}`;
  return `${handleFor(ids[0])} and ${otherPlayers(total - 1)}`;
}

/**
 * Yesterday's best word, announced over today's puzzle as the site opens (see
 * game/bestWordNews.ts): a celebration for a player who found it, and the news
 * of who did for everybody else.
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
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  const { day, best, finderIds } = resolved;
  const ids = finderIds ?? [];
  const total = finderTotal(ids, best.finders);
  const score = formatRarityScore(best.zipf, best.foundOn || day);
  const drop = dropForDate(day);
  const word = <span className="improvement__gain">{best.word}</span>;
  const tally = <span className="improvement__tally">{score}</span>;

  return (
    <>
      {kind === "self" && <ConfettiBurst rising />}
      <div className="improvement improvement--best" role="status">
        <button type="button" className="improvement__card" onClick={onDone} title="Dismiss">
          <span className="improvement__icon" aria-hidden="true">
            {kind === "self" ? "🏆" : "👑"}
          </span>
          <span className="improvement__title">
            {kind === "self" ? "You had yesterday's best word!" : "Yesterday's best word"}
          </span>
          <span className="improvement__body">
            {kind === "self" ? (
              <>
                {word} scored {tally} on “{drop}”, the rarest find of the day.
              </>
            ) : (
              <>
                {finderNames(ids, total)} found {word}, scoring {tally} on “{drop}”.
              </>
            )}
          </span>
        </button>
      </div>
    </>
  );
}
