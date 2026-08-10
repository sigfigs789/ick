import type { CSSProperties } from "react";

const PIECES = Array.from({ length: 24 }, (_, index) => index);

export function ConfettiBurst() {
  return (
    <div className="confetti" aria-hidden="true">
      {PIECES.map((index) => (
        <span
          className="confetti__piece"
          key={index}
          style={{ "--confetti-index": index } as CSSProperties}
        />
      ))}
    </div>
  );
}
