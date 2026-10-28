import { useEffect, type MouseEvent } from "react";
import { ConfettiBurst } from "./ConfettiBurst";
import { trackLeaderboardOpened } from "../analytics";
import { navigate, pathFor } from "../routes";
import type { TopRank, TopRankBoard } from "../game/topRank";

/** How long the card stays up if nobody closes it, as the streak climb's does. */
const CELEBRATION_MS = 7000;

const MEDALS = ["🥇", "🥈", "🥉"];

const WINDOW: Record<TopRankBoard, string> = {
  daily: "today",
  weekly: "this week",
  monthly: "this month",
};

/**
 * A place in the top three of the daily, weekly or monthly board (see
 * game/topRank.ts): the climb's card, in yesterday's-best gold, with the
 * medal for the place and a link to the board itself.
 */
export function TopRankCelebration({ top, onDone }: { top: TopRank; onDone: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, CELEBRATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onDone]);

  // A link, so it opens in a new tab like any other; a plain click stays in
  // the app and takes the card with it.
  function seeBoard(event: MouseEvent<HTMLAnchorElement>) {
    trackLeaderboardOpened("top_rank");
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onDone();
    navigate("leaderboard");
  }

  const { board, rank } = top;
  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement improvement--best" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            {MEDALS[rank - 1]}
          </span>
          <span className="improvement__title">
            {rank === 1 ? `#1 ${WINDOW[board]}!` : `Top 3 ${WINDOW[board]}!`}
          </span>
          <span className="improvement__body">
            You're <span className="improvement__gain">#{rank}</span> on the {board} board.
          </span>
          <a className="improvement__link" href={pathFor("leaderboard")} onClick={seeBoard}>
            See the leaderboard
          </a>
        </div>
      </div>
    </>
  );
}
