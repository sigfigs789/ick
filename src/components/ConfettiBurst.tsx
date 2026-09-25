import type { CSSProperties } from "react";

const PIECES = Array.from({ length: 24 }, (_, index) => index);
/** Twice the pieces, for the rarer occasion (see PerfectMonthCelebration). */
const GRAND_PIECES = Array.from({ length: 48 }, (_, index) => index);

export function ConfettiBurst({ grand = false }: { grand?: boolean }) {
  return (
    <div className={grand ? "confetti confetti--grand" : "confetti"} aria-hidden="true">
      {(grand ? GRAND_PIECES : PIECES).map((index) => (
        <span
          className="confetti__piece"
          key={index}
          style={{ "--confetti-index": index } as CSSProperties}
        />
      ))}
    </div>
  );
}
