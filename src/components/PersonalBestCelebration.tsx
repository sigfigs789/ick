import { CelebrationShareButton } from "./CelebrationShareButton";
import { ConfettiBurst } from "./ConfettiBurst";
import { formatTotal } from "../game/dictionary";
import type { PersonalBest } from "../game/personalBest";


/**
 * The finish that sets the player's best day or best week ever (see
 * game/personalBest.ts).
 *
 * The rising average's card, in sky blue: it lands when the day is done, so it
 * floats over a finished puzzle, and stays until its × is tapped.
 */
export function PersonalBestCelebration({
  best,
  onDone,
}: {
  best: PersonalBest;
  onDone: () => void;
}) {

  const week = best.kind === "week";
  return (
    <>
      <ConfettiBurst grand={week} rising={!week} />
      <div className="improvement improvement--record" role="status">
        <div className="improvement__card">
          <button type="button" className="improvement__close" data-share-omit onClick={onDone} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
          <span className="improvement__icon" aria-hidden="true">
            {week ? "🏅" : "🌟"}
          </span>
          <span className="improvement__title">{week ? "Your best week ever!" : "Your best day ever!"}</span>
          <span className="improvement__body">
            <span className="improvement__gain">{formatTotal(best.score)}</span>{" "}
            {week ? "this week" : "today"}, past your old best of{" "}
            <span className="improvement__tally">{formatTotal(best.previous)}</span>.
          </span>
          <CelebrationShareButton name="personal-best" />
        </div>
      </div>
    </>
  );
}
