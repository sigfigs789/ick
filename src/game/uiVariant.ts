import { hasVisited } from "./visits";
import { playedPuzzleCount } from "./storage";

/**
 * The play-screen experiment: half of all browsers, new and returning alike,
 * get the reworked play screen ("v2") and the other half keep the current one
 * ("control"), so the two can be compared on the analytics page's key numbers.
 *
 * Assigned once per browser and remembered, so a player never flips between
 * layouts. Every event mirrored to Supabase carries the variant (see
 * analytics.ts `mirror`), and the assignment itself is reported once, as
 * `ui_variant_assigned`, which is the row the report groups players by.
 *
 * Only the web entry assigns (main.tsx). Anywhere else -- the Reddit post,
 * tests -- stays on "control" unless something sets it explicitly.
 */

export type UiVariant = "control" | "v2";

export interface UiVariantAssignment {
  variant: UiVariant;
  /** Whether this browser had played or visited before it was assigned. */
  visitType: "first" | "returning";
}

const KEY = "ick:ui-variant";

let current: UiVariant = "control";
let fresh: UiVariantAssignment | null = null;

function parse(raw: string | null): UiVariant | null {
  return raw === "control" || raw === "v2" ? raw : null;
}

/**
 * Settle this browser's variant before the first render.
 *
 * `?ui=v2` or `?ui=control` forces one and remembers it, for checking either
 * layout by hand; a forced variant is not reported as an assignment, so it
 * cannot skew the split. A browser whose storage cannot be written stays on
 * control unreported: it would be re-split on every open.
 */
export function assignUiVariant(search: string, random: () => number = Math.random): UiVariant {
  const forced = parse(new URLSearchParams(search).get("ui"));
  try {
    if (forced) {
      localStorage.setItem(KEY, forced);
      current = forced;
      return current;
    }
    const stored = parse(localStorage.getItem(KEY));
    if (stored) {
      current = stored;
      return current;
    }
    const returning = hasVisited() || playedPuzzleCount() > 0;
    const variant: UiVariant = random() < 0.5 ? "control" : "v2";
    localStorage.setItem(KEY, variant);
    current = variant;
    fresh = { variant, visitType: returning ? "returning" : "first" };
  } catch {
    current = "control";
  }
  return current;
}

/** This browser's variant. */
export function uiVariant(): UiVariant {
  return current;
}

/** Whether the reworked play screen is on. */
export function isNewPlayUi(): boolean {
  return current === "v2";
}

/** The assignment made on this page load, once (reported from Root.tsx). */
export function takeFreshUiAssignment(): UiVariantAssignment | null {
  const taken = fresh;
  fresh = null;
  return taken;
}

/** Tests only. */
export function setUiVariantForTest(variant: UiVariant): void {
  current = variant;
  fresh = null;
}
