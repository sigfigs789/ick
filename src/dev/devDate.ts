/**
 * A movable "today", for development only.
 *
 * Every date in this app comes from `todayDateString()` -- the puzzle you are
 * handed, which archive dates you may step back to, the streak's idea of
 * yesterday, the leaderboard's "Today" group, whether it is Freeform week. So
 * the way to look at a future drop, or to check what a streak does across
 * midnight, is to move that one function rather than to thread a date through
 * the app or to change the machine's clock.
 *
 * Guarded by `DEV_TOOLS` like every dev tool (see src/dev/devTools.ts): on the
 * production build the checks fold to `false`, the branches drop out, and
 * `todayDateString()` is the plain wall-clock reading it has always been. A
 * preview deploy keeps the picker, which is where moving the date is most
 * useful -- on a phone, against a real build.
 */

import { DEV_TOOLS } from "./devTools";

const KEY = "ick:dev-date";

/** The date standing in for today, or null when the wall clock is in charge. */
export function devDateOverride(): string | null {
  if (!DEV_TOOLS) return null;
  try {
    const stored = localStorage.getItem(KEY);
    return stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Set the stand-in date, or pass null to hand today back to the wall clock. */
export function setDevDateOverride(date: string | null): void {
  if (!DEV_TOOLS) return;
  try {
    if (date) localStorage.setItem(KEY, date);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable; the override simply won't hold.
  }
}
