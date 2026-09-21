import { useEffect, useMemo, useState } from "react";
import { fetchBoards } from "../game/leaderboard";
import {
  congratsMessage,
  congratsPopped,
  congratsSpot,
  markCongratsPopped,
} from "../game/congrats";

/**
 * How long the pop animation runs before the bubble is taken off the page.
 *
 * Long enough to read as a burst rather than a disappearance, short enough that
 * nobody waits for it. A timer rather than `animationend`, because a reader who
 * has asked for reduced motion gets no animation to end -- the global rule near
 * the top of index.css cuts every one of them to nothing -- and a bubble that
 * hung around forever for exactly those players would be the worst version of
 * this.
 */
const POP_MS = 260;

/**
 * A bubble floating over the boards, naming the player who won the window that
 * just closed, which pops when it is pressed.
 *
 * It appears on two days: the Tuesday after a week ends and the second of the
 * month after a month does (see game/congrats.ts). The rest of the time this
 * renders nothing and asks the server nothing.
 *
 * Pressing it is the whole of the interaction -- there is no close button
 * hiding in a corner, because the bubble *is* the button and a thing you pop is
 * the one control nobody needs told about. It stays popped afterwards: the
 * window it named is remembered in this browser, so the congratulation is one
 * appearance and not a thing to dismiss again at lunch.
 *
 * Deliberately not part of the boards' own loading: this is a second, small
 * request for a window nothing else on the page is showing, and if it fails or
 * comes back empty the bubble simply never appears. Nothing here can keep the
 * boards from rendering.
 */
export function CongratsBubble({ today }: { today: string }) {
  /**
   * The window being congratulated, fixed for as long as the page is open --
   * `today` is itself frozen at mount by the page above (see LeaderboardPage),
   * so a tab left open across midnight does not grow a bubble.
   */
  const spot = useMemo(() => congratsSpot(today), [today]);
  const [winner, setWinner] = useState<string | null>(null);
  const [popped, setPopped] = useState(false);
  /** Taken off the page, once the pop has finished playing. */
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Nothing to say today, or this one has already been popped on this
    // browser. Checked before the fetch rather than after it, so a player who
    // popped it this morning costs the server nothing this afternoon.
    if (!spot || congratsPopped(spot)) return;
    let live = true;
    // The same endpoint the boards come from, asked for the closed window
    // instead of the live one. It answers with all three boards and only one of
    // them is read, which is the price of not adding an endpoint for a sentence
    // that appears twice a month.
    fetchBoards(today, spot.window === "week" ? { week: spot.start } : { month: spot.start })
      .then((boards) => {
        if (!live) return;
        const board = spot.window === "week" ? boards.weekly : boards.monthly;
        // A window nobody scored in has no winner to name, and a bubble reading
        // "Congrats undefined" is worse than no bubble.
        const champion = board.find((entry) => entry.rank === 1) ?? board[0];
        if (champion) setWinner(champion.name);
      })
      // A congratulation that couldn't load is not something to tell anybody
      // about -- it is a nicety, and the boards under it are the page.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [spot, today]);

  // The live region goes up with the page and fills when the name lands, rather
  // than arriving already full: a region that appears with its content in it is
  // one plenty of screen readers never announce.
  if (!spot || gone) return null;

  function pop() {
    if (!spot || popped) return;
    // Remembered on the press rather than when the animation finishes, so a
    // reader who navigates away mid-pop has still popped it.
    markCongratsPopped(spot);
    setPopped(true);
    window.setTimeout(() => setGone(true), POP_MS);
  }

  return (
    // Fixed to the foot of the viewport, not to a point in the page: it floats
    // *over* the boards, so it has to stay in front of whichever rows a reader
    // has scrolled to. Low rather than centred, so it never covers the rows it
    // is about.
    <div className="congrats-bubble" aria-live="polite">
      {winner && (
        <button
          type="button"
          className={`congrats-bubble__pop${popped ? " congrats-bubble__pop--popped" : ""}`}
          onClick={pop}
          // What pressing it does, for a reader who cannot see that it is a
          // bubble. The message itself is the label, so this is the only part
          // that needs saying separately.
          title="Pop"
        >
          <span className="congrats-bubble__emoji" aria-hidden="true">
            🎉
          </span>
          <span className="congrats-bubble__text">
            {congratsMessage(winner, spot)}
          </span>
        </button>
      )}
    </div>
  );
}
