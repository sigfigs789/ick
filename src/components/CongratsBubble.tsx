import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { fetchBoards } from "../game/leaderboard";
import {
  type CongratsSpot,
  congratsMessage,
  markCongratsPopped,
  pendingCongratsSpots,
  wanderPath,
} from "../game/congrats";
import { useSound } from "../hooks/useSound";

/**
 * How long the splat is on screen before it is taken off the page.
 *
 * The blot lands fast, sits for a beat and soaks away, which is long enough to
 * be the thing the reader did and short enough that nobody waits for it. A
 * timer rather than `animationend`, because a reader who has asked for reduced
 * motion gets no animation to end -- the global rule near the top of
 * index.css cuts every one of them to nothing -- and ink that stayed on the
 * board forever for exactly those players would be the worst version of this.
 */
const SPLAT_MS = 900;

/**
 * How many droplets fly off the blot.
 *
 * Enough to read as ink hitting paper rather than a circle appearing; few
 * enough that each one is its own mark. They are thrown at even angles from
 * the centre and land at different distances (see the nth-child rules in
 * index.css), which is what keeps an even fan from looking like a clock face.
 */
const DROPLETS = 7;

/**
 * A bubble drifting around the boards, naming the player who won the window
 * that just closed, which splats into an ink blot when it is hit.
 *
 * It stands for four days after a window closes -- Monday to Thursday for a
 * week, the second to the fifth for a month (see game/congrats.ts) -- so a
 * player who only opens the boards midweek still gets told. The rest of the
 * time, and once it has been popped, this renders nothing and asks the server
 * nothing.
 *
 * It moves, and that is the point: a notice parked at the foot of the page is
 * furniture, and furniture is read once and then looked past. Something
 * wandering over the board is asking to be hit -- and this game is called
 * WordInk, so what a hit leaves behind is ink. Pressing it is the whole of the
 * interaction; there is no close button hiding in a corner, because the bubble
 * *is* the button.
 *
 * Popping it is final: the window it named is remembered in this browser, so
 * one splat ends that congratulation for good, whatever is left of its four
 * days. When more than one is owed -- each window has a Standard and a Freeform
 * winner, and a month and a week can close together -- they all float at once,
 * each spawning somewhere different on a wander of its own.
 *
 * Deliberately not part of the boards' own loading: this is a second, small
 * request for a window nothing else on the page is showing, and if it fails or
 * comes back empty the bubble simply never appears. Nothing here can keep the
 * boards from rendering.
 */
export function CongratsBubble({ today }: { today: string }) {
  /**
   * The wins owed, fixed for as long as the page is open -- `today` is itself
   * frozen at mount by the page above (see LeaderboardPage), so a tab left open
   * across midnight does not grow a bubble.
   */
  const owed = useMemo(() => pendingCongratsSpots(today), [today]);
  return (
    <>
      {owed.map((spot) => (
        <Bubble key={`${spot.mode}:${spot.window}:${spot.start}`} today={today} spot={spot} />
      ))}
    </>
  );
}

/** One congratulation: the name, the drift, and the ink it leaves when hit. */
function Bubble({ today, spot }: { today: string; spot: CongratsSpot }) {
  /**
   * Where this bubble spawns and wanders, drawn once for its life on the page
   * and handed to the drift's keyframes (see index.css). Its own pace too, a
   * little off the others', so bubbles owed together never move in step.
   */
  const [wander] = useState(() => {
    const style: Record<string, string> = {
      "--wander-duration": `${22 + Math.random() * 8}s`,
    };
    wanderPath().forEach((stop, index) => {
      style[`--wander-x${index}`] = `${50 + stop.x * 26}%`;
      style[`--wander-y${index}`] = `${12 + stop.y * 66}%`;
    });
    return style as CSSProperties;
  });
  const [winner, setWinner] = useState<string | null>(null);
  /** Hit: the bubble is gone and the ink is landing where it was. */
  const [splatting, setSplatting] = useState(false);
  /** Taken off the page, once the ink has soaked away. */
  const [gone, setGone] = useState(false);
  const sound = useSound();

  useEffect(() => {
    // Nothing owed today never gets this far -- either no window is standing or
    // every one that is has been popped here already, which the queue above
    // settles before any fetch, so a player who popped it on the Monday costs
    // the server nothing on the Tuesday.
    let live = true;
    // The same endpoint the boards come from, asked for the closed window
    // instead of the live one, and for this win's mode rather than the reader's:
    // both winners are named whichever switch the reader is on. It answers with
    // all three boards and only one of them is read, which is the price of not
    // adding an endpoint for a sentence that appears a few times a month.
    const closed = spot.window === "week" ? { week: spot.start } : { month: spot.start };
    fetchBoards(today, { ...closed, mode: spot.mode })
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
  if (gone) return null;

  function splat() {
    if (splatting) return;
    // Remembered on the hit rather than when the ink clears, so a reader who
    // navigates away mid-splat has still popped it.
    markCongratsPopped(spot);
    // Applause as the ink lands -- inside the press, which is the gesture the
    // browser needs before it will play anything. A month's is the bigger one.
    sound.applause(spot.window);
    setSplatting(true);
    window.setTimeout(() => setGone(true), SPLAT_MS);
  }

  return (
    // Over the boards rather than in the flow beside them -- the layer the
    // bubble wanders across. It catches nothing itself: the page underneath is
    // still the page, and only the bubble takes a press.
    <div className="congrats-bubble" aria-live="polite">
      {winner && (
        // The wandering happens here, on the layer the bubble and its ink share,
        // so the blot lands exactly where the bubble was standing when it was
        // hit -- the drift is held still for the splat rather than restarted.
        <div
          className="congrats-bubble__drift"
          style={wander}
          data-splatting={splatting ? "" : undefined}
        >
          {splatting ? (
            <span className="congrats-bubble__splat" aria-hidden="true">
              {Array.from({ length: DROPLETS }, (_, index) => (
                <span key={index} className="congrats-bubble__drop" />
              ))}
            </span>
          ) : (
            <button
              type="button"
              className="congrats-bubble__pop"
              onClick={splat}
              // What hitting it does, for a reader who cannot see that it is a
              // bubble. The message itself is the label, so this is the only
              // part that needs saying separately.
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
      )}
    </div>
  );
}
