import { isReturningSession } from "./visits";
import { isTester } from "./testers";

/**
 * The play-screen experiment: the reworked play screen ("v2") against the
 * current one ("control"), compared on the analytics page's key numbers.
 *
 * Two experiments, each drawn on its own coin, the same way as the idle hint
 * (see game/idleHint.ts):
 *   - `new`: a first-ever session. 70% get v2 and 30% control, to send most
 *     new players to the v2 flow (50/50 until 2026-10-19).
 *   - `returning`: any later session, split 50/50.
 *
 * A player is placed in each experiment the first time they open the game as
 * that kind of player, and keeps the arm for good. The two draws are
 * independent, so a new player's arm says nothing about the one they get once
 * they come back -- each experiment stays a clean split of its own players,
 * at the cost of some new players seeing the other screen on their first
 * return. Within a session the screen never changes: a session's kind is
 * settled by its first page load (see game/visits.ts `isReturningSession`).
 *
 * Every event mirrored to Supabase carries the session's variant (see
 * analytics.ts `mirror`), and each draw is reported once, as
 * `ui_variant_assigned` with its experiment, which is the row the report
 * groups players by.
 *
 * Only the web entry assigns (main.tsx). The Reddit post is outside the
 * experiment and pins v2 (see `pinUiVariant`); anywhere else -- tests -- stays
 * on "control" unless something sets it explicitly.
 */

export type UiVariant = "control" | "v2";
export type UiExperiment = "new" | "returning";

export interface UiVariantAssignment {
  experiment: UiExperiment;
  variant: UiVariant;
}

const ARMS_KEY = "ick:ui-arms";
const FORCED_KEY = "ick:ui-forced";
/**
 * The single, everyone-alike draw from before the split by experiment. Taken
 * over as the arm of the first experiment that needs one, so nobody already in
 * the test changes screens when this ships; it was a fair coin, so it keeps
 * that experiment 50/50. Anyone holding one has visited before, so it is the
 * returning experiment that takes it over, and that one is still 50/50.
 */
const LEGACY_KEY = "ick:ui-variant";

type Arms = Partial<Record<UiExperiment, UiVariant>>;

/** The share of each experiment's fresh draws put on v2. */
export const V2_SHARE: Record<UiExperiment, number> = { new: 0.7, returning: 0.5 };

let current: UiVariant = "control";
let fresh: UiVariantAssignment | null = null;

function parse(raw: unknown): UiVariant | null {
  return raw === "control" || raw === "v2" ? raw : null;
}

function loadArms(): Arms {
  const raw = localStorage.getItem(ARMS_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const stored = parsed as Record<string, unknown>;
  const out: Arms = {};
  const first = parse(stored.new);
  const returning = parse(stored.returning);
  if (first) out.new = first;
  if (returning) out.returning = returning;
  return out;
}

/** Which experiment this session belongs to. */
export function uiExperiment(): UiExperiment {
  return isReturningSession() ? "returning" : "new";
}

/**
 * Settle this session's variant before the first render.
 *
 * `?ui=v2` or `?ui=control` forces one and remembers it, for checking either
 * layout by hand; a forced variant is not reported as an assignment, so it
 * cannot skew the split. A hand-picked tester (see game/testers.ts) gets v2
 * the same way, unreported, but not remembered: the browser keeps whatever it
 * was assigned for if they are ever taken off the list. A browser whose
 * storage cannot be written stays on control unreported: it would be re-split
 * on every open.
 */
export function assignUiVariant(search: string, random: () => number = Math.random): UiVariant {
  const forced = parse(new URLSearchParams(search).get("ui"));
  try {
    if (forced) {
      localStorage.setItem(FORCED_KEY, forced);
      current = forced;
      return current;
    }
    if (isTester()) {
      current = "v2";
      return current;
    }
    const remembered = parse(localStorage.getItem(FORCED_KEY));
    if (remembered) {
      current = remembered;
      return current;
    }
    const experiment = uiExperiment();
    const arms = loadArms();
    const existing = arms[experiment];
    if (existing) {
      current = existing;
      return current;
    }
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    const variant: UiVariant = legacy ?? (random() < V2_SHARE[experiment] ? "v2" : "control");
    localStorage.setItem(ARMS_KEY, JSON.stringify({ ...arms, [experiment]: variant }));
    localStorage.removeItem(LEGACY_KEY);
    current = variant;
    fresh = { experiment, variant };
  } catch {
    current = "control";
  }
  return current;
}

/** This session's variant. */
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

/**
 * Put a host outside the experiment on one screen for good. Call before the
 * first render.
 *
 * For a host that reports nothing, so a split there would be measured by
 * nobody: the Reddit post, which shows v2 to every player. Not an assignment --
 * nothing is stored and nothing is reported -- so it can never leak into the
 * website's numbers.
 */
export function pinUiVariant(variant: UiVariant): void {
  current = variant;
  fresh = null;
}

/** Tests only. */
export function setUiVariantForTest(variant: UiVariant): void {
  current = variant;
  fresh = null;
}
