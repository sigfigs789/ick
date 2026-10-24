/**
 * What coming back tomorrow is worth, said at the moment a player is most
 * likely to leave: once today's word is banked.
 *
 * Nothing on a played puzzle used to look forward. The streak sat there as a
 * number and the freezes as a badge, so a player finished, shared or didn't,
 * and had no reason in front of them to return -- which is what D1 measures.
 * `streakGoal` names the one reward most worth returning for: a freeze it
 * earns, a Saturday off, or the best streak it is closing in on.
 */

import { addDays } from "./date";
import { freezeCap, restDayProgress } from "./streakFreeze";
import type { StreakState } from "./types";

/** Whether a streak reaching `days` played days earns a saved freeze (see streakFreeze.earnFreeze). */
function earnsFreezeOn(days: number): boolean {
  return days === 3 || (days > 0 && days % 7 === 0);
}

/**
 * The one reason to come back tomorrow, for a streak that has already been
 * played today. "Play tomorrow to make it a 5-day streak" is never said: that
 * playing tomorrow grows the streak is a given, and a second line under it
 * only buried the reward that was actually news.
 *
 * Soonest first: of the next freeze that would fit under the cap, a lazy
 * Saturday (see `restDayProgress` in game/streakFreeze.ts) and beating the
 * best streak, whichever lands in the fewest days played. A tie goes to the
 * freeze, the thing they keep, then to the lazy Saturday, which lapses with
 * its week. A lazy Saturday already unlocked is said every weekday left, so
 * the day it unlocks is never silent; it counts as a day away, so it gives
 * way only to a freeze tomorrow. Then a record run, and only with nothing
 * else to say, that a streak starts tomorrow. A lazy Saturday is only
 * promised while the week has days enough left to earn it.
 *
 * A freeze past the cap is not kept, so it is not promised. A player already
 * holding one hears which it would be -- a 2nd, a 3rd -- since "your next
 * freeze" reads as the one they have. And a player whose cap is full hears
 * that the cap rises, since that is what the wait is for: the day it rises
 * also earns the freeze that fills it.
 */
export function streakGoal(streak: StreakState, today: string): string {
  const days = streak.currentStreak;
  const next = days + 1;
  const best = Math.max(streak.longestStreak, days);
  const banked = streak.bankedFreezes ?? 0;
  const keeps = (on: number) => earnsFreezeOn(on) && banked < freezeCap(Math.max(best, on));

  // Only up to two are ever earned, so the next is at most the 2nd. (A player
  // still holding three from the old limit has a full cap, so is never told one.)
  const nth = ["", "", "2nd", "3rd"][banked + 1];
  const capFull = banked > 0 && banked >= freezeCap(best);

  // Each reward with the days played until it lands, and its rank in a tie.
  const goals: { away: number; rank: number; line: string }[] = [];

  // A full cap only rises at 14 days, and a kept freeze is never more than
  // four weeks out.
  for (let freezeDay = next; freezeDay <= next + 28; freezeDay++) {
    if (!keeps(freezeDay)) continue;
    const away = freezeDay - days;
    let line: string;
    if (away === 1) {
      if (capFull) line = `Tomorrow your 🧊 freeze limit goes up to ${banked + 1}, and you earn a freeze to fill it.`;
      else if (nth) line = `Tomorrow earns a ${nth} 🧊 streak freeze.`;
      else line = "Tomorrow earns a 🧊 freeze, which saves your streak on a day you miss.";
    } else if (capFull) {
      line = `${away} days until your 🧊 freeze limit goes up to ${banked + 1}.`;
    } else {
      line = `${away} days to ${nth ? `a ${nth}` : "your next"} 🧊 streak freeze.`;
    }
    goals.push({ away, rank: 0, line });
    break;
  }

  // Only for a streak worth resting: a lost one has nothing for Saturday to keep.
  const rest = days > 0 ? restDayProgress(streak, today) : null;
  if (rest) {
    const line =
      rest.needed === 0
        ? rest.saturday === addDays(today, 1)
          ? "Lazy Saturday unlocked: skip tomorrow and your streak is safe."
          : "Lazy Saturday unlocked 😴 Skip Saturday and your streak is safe."
        : rest.needed === 1
          ? "Play tomorrow for a lazy Saturday 😴"
          : `${rest.needed} more days by Friday unlocks a lazy Saturday 😴`;
    goals.push({ away: Math.max(rest.needed, 1), rank: 1, line });
  }

  if (best > days) {
    goals.push({ away: best - days + 1, rank: 2, line: `${best - days + 1} days to beat your best streak of ${best}.` });
  }

  goals.sort((x, y) => x.away - y.away || x.rank - y.rank);
  if (goals.length > 0) return goals[0].line;
  if (days >= 2) return "This is your longest streak yet.";
  return "Play tomorrow to start a streak.";
}
