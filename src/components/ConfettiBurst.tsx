import type { CSSProperties } from "react";

const PIECES = Array.from({ length: 24 }, (_, index) => index);
/** Twice the pieces, for the rarer occasion (see PerfectMonthCelebration). */
const GRAND_PIECES = Array.from({ length: 48 }, (_, index) => index);

/**
 * `grand` is the perfect month's burst; `rising` is the improving average's
 * (see ImprovementCelebration), which shoots up from the bottom of the screen
 * instead of falling from the top.
 */
export function ConfettiBurst({
  grand = false,
  rising = false,
}: {
  grand?: boolean;
  rising?: boolean;
}) {
  const className = ["confetti", grand && "confetti--grand", rising && "confetti--rising"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} aria-hidden="true">
      {(grand || rising ? GRAND_PIECES : PIECES).map((index) => (
        <span
          className="confetti__piece"
          key={index}
          style={{ "--confetti-index": index } as CSSProperties}
        />
      ))}
    </div>
  );
}
