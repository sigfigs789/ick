/**
 * What coming back tomorrow is worth, said at the moment a player is most
 * likely to leave: once today's word is banked.
 *
 * Nothing on a played puzzle used to look forward. The streak sat there as a
 * number and the freezes as a badge, so a player finished, shared or didn't,
 * and had no reason in front of them to return -- which is what D1 measures.
 * `streakGoal` names the next reward: the next streak count, a freeze it
 * earns, or the best streak it is closing in on.
 */

import { freezeCap } from "./streakFreeze";
import type { StreakState } from "./types";

/** Whether a streak reaching `days` played days earns a saved freeze (see streakFreeze.earnFreeze). */
function earnsFreezeOn(days: number): boolean {
  return days === 3 || (days > 0 && days % 7 === 0);
}

export interface StreakGoal {
  /** What playing tomorrow does: always said. */
  headline: string;
  /** The next milestone past tomorrow, when there is one worth naming. */
  detail?: string;
}

/**
 * What tomorrow is worth, for a streak that has already been played today.
 *
 * The detail names the nearest thing a player can actually get: a freeze
 * tomorrow, else the next freeze that would fit under the cap, else the best
 * streak they have run. A freeze past the cap is not kept, so it is not
 * promised. A player already holding one hears which it would be -- a 2nd,
 * a 3rd -- since "your next freeze" reads as the one they have. And a player
 * whose cap is full hears that the cap rises, since that is what the wait is
 * for: the day it rises also earns the freeze that fills it.
 */
export function streakGoal(streak: StreakState): StreakGoal {
  const days = streak.currentStreak;
  const next = days + 1;
  const best = Math.max(streak.longestStreak, days);
  const banked = streak.bankedFreezes ?? 0;
  const keeps = (on: number) => earnsFreezeOn(on) && banked < freezeCap(Math.max(best, on));

  const headline =
    days <= 1
      ? "Play tomorrow to start a streak."
      : `Play tomorrow to make it a ${next}-day streak.`;

  // Only up to three are ever held, so the next is at most the 3rd.
  const nth = ["", "", "2nd", "3rd"][banked + 1];
  const capFull = banked > 0 && banked >= freezeCap(best);

  if (keeps(next)) {
    let detail = "Tomorrow earns a 🧊 freeze, which saves your streak on a day you miss.";
    if (capFull) detail = `Tomorrow you can hold ${banked + 1} 🧊 streak freezes, and you earn another 🧊.`;
    else if (nth) detail = `Tomorrow earns a ${nth} 🧊 streak freeze.`;
    return { headline, detail };
  }
  // A full cap only rises at 14 and 28 days, so four weeks out is as far as a
  // kept freeze can be.
  for (let freezeDay = next + 1; freezeDay <= next + 28; freezeDay++) {
    if (keeps(freezeDay)) {
      const away = freezeDay - days;
      if (capFull) {
        return { headline, detail: `${away} days until you can hold ${banked + 1} 🧊 streak freezes.` };
      }
      return { headline, detail: `${away} days to ${nth ? `a ${nth}` : "your next"} 🧊 streak freeze.` };
    }
  }
  if (best > days) {
    const away = best - days + 1;
    return { headline, detail: `${away} days to beat your best streak of ${best}.` };
  }
  if (days >= 2) return { headline, detail: "This is your longest streak yet." };
  return { headline };
}
