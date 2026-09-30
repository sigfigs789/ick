import { todayDateString } from "./date";
import { DEFAULT_MODE, setMode, type GameMode } from "./mode";
import { playedPuzzleCount } from "./storage";
import { arrivalSource, hasVisited } from "./visits";

/**
 * The mode a brand-new player starts in.
 *
 * Everyone who has already opened the game keeps whatever they have: this runs
 * once, for a browser with no visit on record, no mode chosen and no puzzle
 * played, and never again. What it picks for them depends on how they arrived:
 *
 *   - `shared`   a link a friend copied or posted, carrying the mode it was
 *                shared from (`?s=sh.f`, `?s=t.s` -- see `shareCode`). They
 *                start where their friend is, so the result they were sent is
 *                the game they are about to play.
 *   - `default`  a share link from before links carried a mode. Standard, as
 *                it has always been.
 *   - `split`    everyone else -- Reddit, Google, any other site, and arrivals
 *                with no source at all (no code, no referrer). Half start in
 *                Freeform and half in Standard, at random, so the two can be
 *                compared on players who chose neither.
 *
 * Whatever it picks is only a starting point. The switch in the header works
 * the same as ever, and moving it is recorded like any other switch.
 */

export type AssignmentReason = "shared" | "default" | "split";

export interface ModeAssignment {
  mode: GameMode;
  reason: AssignmentReason;
  /** The arrival source as the visit record keeps it: `sh`, `reddit`, ... */
  source: string | null;
  /** The puzzle the player arrived on. */
  date: string;
}

const ASSIGNMENT_KEY = "ick:mode-assignment";
const MODE_KEY = "ick:mode";

const MODE_CODES: Record<string, GameMode> = { f: "freeform", s: "standard" };
const CODE_FOR_MODE: Record<GameMode, string> = { freeform: "f", standard: "s" };

/** The compact codes a share link is tagged with. */
const SHARE_CODES = new Set(["sh", "t"]);

/**
 * A share-link code with the mode it was shared from: `sh.f`, `t.s`.
 *
 * One letter after a dot, because the link sits at the bottom of a result that
 * people paste into group chats, and the shorter it is the less it looks like
 * tracking.
 */
export function shareCode(base: string, mode: GameMode): string {
  return `${base}.${CODE_FOR_MODE[mode]}`;
}

/**
 * Split an `s=` code into the source and the mode it carries, if any.
 *
 * `sh.f` is the share source with Freeform; `sh` is the same source from a link
 * that predates the mode. An unknown suffix is dropped rather than failing the
 * whole code, so a mangled link still counts as a share.
 */
export function parseSourceCode(raw: string | null): { base: string | null; mode: GameMode | null } {
  if (!raw) return { base: null, mode: null };
  const [base, suffix] = raw.trim().toLowerCase().split(".", 2);
  return { base: base || null, mode: (suffix && MODE_CODES[suffix]) || null };
}

/** The mode a share link was sent from, or null for any other link. */
export function sharedModeFromSearch(search: string): GameMode | null {
  const { base, mode } = parseSourceCode(new URLSearchParams(search).get("s"));
  return base && SHARE_CODES.has(base) ? mode : null;
}

function isNewPlayer(): boolean {
  try {
    if (localStorage.getItem(ASSIGNMENT_KEY) !== null) return false;
    if (localStorage.getItem(MODE_KEY) !== null) return false;
  } catch {
    // Storage that cannot be read cannot remember an assignment either, and a
    // browser that would be split afresh on every open is not an experiment.
    return false;
  }
  return !hasVisited() && playedPuzzleCount() === 0;
}

/** Which mode a new player arriving through `search`/`referrer` starts in. */
export function chooseStartingMode(
  search: string,
  referrer?: string,
  selfHost?: string,
  random: () => number = Math.random,
): Pick<ModeAssignment, "mode" | "reason" | "source"> {
  const source = arrivalSource(search, referrer, selfHost);
  const shared = sharedModeFromSearch(search);
  if (shared) return { mode: shared, reason: "shared", source };
  if (source !== null && SHARE_CODES.has(source)) {
    return { mode: DEFAULT_MODE, reason: "default", source };
  }
  return { mode: random() < 0.5 ? "freeform" : "standard", reason: "split", source };
}

/** This page load's assignment, until the one caller that reports it takes it. */
let fresh: ModeAssignment | null = null;

/**
 * Give a brand-new player their starting mode, before anything renders.
 *
 * Has to run ahead of the first render, because scoring and the day's saved
 * progress are both read under the current mode -- switching after the puzzle
 * has loaded would load it twice. Returns null for everybody else.
 */
export function assignStartingMode(
  search: string,
  today: string = todayDateString(),
  referrer?: string,
  selfHost?: string,
  random?: () => number,
): ModeAssignment | null {
  if (!isNewPlayer()) return null;
  const assignment: ModeAssignment = {
    ...chooseStartingMode(search, referrer, selfHost, random),
    date: today,
  };
  try {
    localStorage.setItem(ASSIGNMENT_KEY, JSON.stringify(assignment));
  } catch {
    return null;
  }
  // Stored even for Standard, so the choice is a choice a later visit can see
  // was already made -- and so the header switch reads it as one.
  try {
    localStorage.setItem(MODE_KEY, assignment.mode);
  } catch {
    // Written just above, so this does not fail on its own.
  }
  setMode(assignment.mode);
  fresh = assignment;
  return assignment;
}

/**
 * The assignment made on this page load, once. Reported by the app after the
 * board id exists (see Root.tsx), so the event can be joined to a player.
 */
export function takeFreshAssignment(): ModeAssignment | null {
  const taken = fresh;
  fresh = null;
  return taken;
}

/** Tests only. */
export function resetFreshAssignment(): void {
  fresh = null;
}
