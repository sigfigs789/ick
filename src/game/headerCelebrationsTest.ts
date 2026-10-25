import { isTester } from "./testers";

/**
 * The header celebrations test: whether the cards over the top of today's
 * puzzle (see headerCelebrations.ts) bring players back.
 *
 * Split 75/25: `shown` sees the cards, `hidden` sees none of them -- no card,
 * no confetti, no chime. A player is drawn the first time a card would appear,
 * which is the moment the two arms start to differ, and keeps the arm for
 * good. The draw is reported once, as `header_celebrations_assigned`, and
 * /experimentsV2 reads the arms from that day on (see the analytics_v2_experiment
 * migration).
 */

export type HeaderCelebrationsVariant = "shown" | "hidden";

/** The share of players who see the cards. */
export const HEADER_CELEBRATIONS_SHOW_SHARE = 0.75;

const ASSIGNMENT_KEY = "ick:header-celebrations-test";

function isVariant(value: unknown): value is HeaderCelebrationsVariant {
  return value === "shown" || value === "hidden";
}

/**
 * The player's arm, drawing one if they have none. `fresh` is true only on the
 * draw itself, so the caller reports it once. Null when storage cannot keep
 * the draw: a player re-drawn on every open is not in the test, so that
 * browser sees the cards and is left out.
 */
export function assignHeaderCelebrationsArm(
  random: () => number = Math.random
): { variant: HeaderCelebrationsVariant; fresh: boolean } | null {
  try {
    const stored = localStorage.getItem(ASSIGNMENT_KEY);
    if (isVariant(stored)) return { variant: stored, fresh: false };
    const variant: HeaderCelebrationsVariant = random() < HEADER_CELEBRATIONS_SHOW_SHARE ? "shown" : "hidden";
    localStorage.setItem(ASSIGNMENT_KEY, variant);
    return { variant, fresh: true };
  } catch {
    return null;
  }
}

/**
 * An arm forced with `?header-celebrations=hidden` (or `=shown`), for seeing
 * either without waiting on a draw; a hand-picked tester (see testers.ts) is
 * forced to shown. A forced arm is never stored or reported, so it cannot leak
 * into the split.
 */
export function forcedHeaderCelebrationsVariant(
  search: string = window.location.search
): HeaderCelebrationsVariant | null {
  const value = new URLSearchParams(search).get("header-celebrations");
  if (isVariant(value)) return value;
  return isTester() ? "shown" : null;
}
