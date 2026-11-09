/**
 * The wall clock as a puzzle date, in a module of its own.
 *
 * game/mode.ts needs today's date and cannot import game/date.ts: tests mock
 * that module, and the mocks load the dictionary, which loads mode -- a cycle
 * that never resolves. date.ts re-exports both, so everything else is
 * unchanged.
 */

import { devDateOverride } from "../dev/devDate";
import { DEV_TOOLS } from "../dev/devTools";

/** Returns today's date as YYYY-MM-DD in the player's local timezone.
 *
 * In a development or preview build a date picked from the dev bar stands in
 * for the wall clock, so the whole app -- puzzle, archive, streak, boards --
 * can be moved through time together. See src/dev/devDate.ts; on production,
 * unless switched on with `?dev=1`, this is the wall clock alone. */
export function todayDateString(): string {
  if (DEV_TOOLS) {
    const override = devDateOverride();
    if (override) return override;
  }
  return toDateString(new Date());
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
