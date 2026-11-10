import type { MouseEvent } from "react";
import { CelebrationShareButton } from "./CelebrationShareButton";
import { ConfettiBurst } from "./ConfettiBurst";
import { trackLeaderboardOpened } from "../analytics";
import { navigate, pathFor } from "../routes";


const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * A place in the top three of today's board (see game/topRank.ts): the
 * climb's card, in yesterday's-best gold, with the medal for the place and a
 * link to the board itself.
 */
export function TopRankCelebration({ rank, onDone }: { rank: number; onDone: () => void }) {

  // A link, so it opens in a new tab like any other; a plain click stays in
  // the app and takes the card with it.
  function seeBoard(event: MouseEvent<HTMLAnchorElement>) {
    trackLeaderboardOpened("top_rank");
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onDone();
    navigate("leaderboard");
  }

  return (
    <>
      <ConfettiBurst rising />
      <div className="improvement improvement--best" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" data-share-omit onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            {MEDALS[rank - 1]}
          </span>
          <span className="improvement__title">{rank === 1 ? "#1 today!" : "Top 3 today!"}</span>
          <span className="improvement__body">
            You're <span className="improvement__gain">#{rank}</span> on today's board.
          </span>
          <a className="improvement__link" data-share-omit href={pathFor("leaderboard")} onClick={seeBoard}>
            See the leaderboard
          </a>
          <CelebrationShareButton name="top-three" />
        </div>
      </div>
    </>
  );
}
