import { useEffect, useState } from "react";
import { comebackLine, formatCountdown, freezeLine, msUntilNextDrop } from "../game/nextDrop";
import type { StreakState } from "../game/types";

interface Props {
  /** Today's puzzle date. Only ever shown on today's finished puzzle. */
  date: string;
  streak: StreakState;
}

/** Often enough that the minutes never visibly lag; rarely enough to cost nothing. */
const TICK_MS = 30_000;

/**
 * The bottom of a finished puzzle: when the next drop lands, and why to be
 * there for it (see game/nextDrop.ts).
 */
export function NextDrop({ date, streak }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const comeback = comebackLine(streak, date);
  const freezes = freezeLine(streak, date);
  return (
    <section className="next-drop" aria-label="Next puzzle">
      <p className="next-drop__countdown">
        Next drop in <strong>{formatCountdown(msUntilNextDrop(now))}</strong>
      </p>
      {comeback && <p className="next-drop__line">{comeback}</p>}
      {freezes && (
        <p className="next-drop__line next-drop__freeze">
          <span aria-hidden="true">🧊 </span>
          {freezes}
        </p>
      )}
    </section>
  );
}
