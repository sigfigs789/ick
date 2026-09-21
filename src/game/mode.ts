/**
 * Which rules the player is playing under: Standard or Freeform.
 *
 * Freeform started as a week (see FREEFORM_START in game/dictionary.ts) -- a
 * window in the calendar where the scoring fold was switched off for everybody.
 * It ends as a switch. From MODE_CHOICE_START the window is gone and the two
 * systems sit side by side, with the player choosing which one they are playing
 * and the choice remembered.
 *
 * The mode is a *player* setting, not a puzzle one. Every puzzle from the choice
 * date on can be played either way, each mode carries its own progress (a full
 * set of guesses each -- see game/storage.ts) and its own leaderboards, and
 * nothing about a past puzzle moves: dates before MODE_CHOICE_START still answer
 * to the calendar, so the trial week keeps the rules it was played with and
 * everything before it keeps the fold.
 *
 * Held in a module variable as well as in storage, deliberately. Scoring is
 * asked about a word in a hundred places -- `rarityFor`, `rarityScore`,
 * `evaluateSubmission`, the share text, the leaderboard's pricing -- and
 * threading a mode argument through all of them would put the same value in
 * every signature in the game to say a thing that is true of the whole session.
 * One player plays one mode at a time; this is that one.
 */

export type GameMode = "standard" | "freeform";

export const GAME_MODES: readonly GameMode[] = ["standard", "freeform"];

/** What each mode is called on screen. */
export const MODE_LABELS: Record<GameMode, string> = {
  standard: "Standard",
  freeform: "Freeform",
};

/**
 * The first puzzle the player chooses their own rules for.
 *
 * Before it, the mode is decided by the calendar and this setting is not
 * consulted at all: an archived puzzle plays exactly as it played, which is the
 * same promise every scoring cutover in game/dictionary.ts makes. On and after
 * it, the switch in the header decides.
 *
 * A puzzle date compared as a string, like every other cutover in this game, so
 * it turns over with the puzzle rather than with a clock.
 */
export const MODE_CHOICE_START = "2026-09-27";

/**
 * Standard, for a player who has never touched the switch.
 *
 * The folding system is the game as it has been for months and as every archived
 * puzzle scored; Freeform is the variant. A default that quietly rescored
 * everybody's daily puzzle would be the trial week never ending.
 */
export const DEFAULT_MODE: GameMode = "standard";

const MODE_KEY = "ick:mode";

function isMode(value: unknown): value is GameMode {
  return value === "standard" || value === "freeform";
}

/**
 * The chosen mode as storage has it.
 *
 * A browser that cannot read storage plays Standard, which is the same answer it
 * gives a player who has never chosen -- there is no third state, and a mode
 * that cannot be remembered is one nobody selected.
 */
export function loadMode(): GameMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return isMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/**
 * The session's mode, read by scoring.
 *
 * Seeded from storage on first read so nothing has to be initialised before the
 * game can price a word, and kept in step by `setMode` from there on.
 */
let current: GameMode | null = null;

export function currentMode(): GameMode {
  if (current === null) current = loadMode();
  return current;
}

type Listener = (mode: GameMode) => void;
const listeners = new Set<Listener>();

/**
 * Switch modes: remember it, and tell whoever is rendering.
 *
 * The subscription exists because the mode is read as a module variable rather
 * than passed down -- React has no way to know a value it never saw has changed,
 * so the one place that changes it says so out loud. See hooks/useGameMode.ts.
 */
export function setMode(mode: GameMode): void {
  if (mode === currentMode()) return;
  current = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // A browser that cannot remember the choice still honours it for this
    // session, which is the more useful half of the two.
  }
  for (const listener of listeners) listener(mode);
}

export function subscribeToMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The other one, for a control whose whole job is to swap them. */
export function otherMode(mode: GameMode): GameMode {
  return mode === "standard" ? "freeform" : "standard";
}

/**
 * The trial week: the window in which Freeform was the calendar's decision
 * rather than the player's.
 *
 * Start inclusive, end exclusive, so the trial ran 2026-09-14 through
 * 2026-09-26 and MODE_CHOICE_START picks up the day after. Kept here rather than
 * in game/dictionary.ts -- where the scoring cutovers live and where these two
 * are re-exported from -- because this file is the one thing both the scoring
 * and the record have to agree with about which mode a given day is in, and a
 * constant with two homes is a constant that eventually disagrees with itself.
 *
 * Every day inside it stays inside it forever. That is the whole reason the
 * switch is a new era rather than a rewrite of this one: a puzzle played under
 * the trial keeps the scores it was played with, exactly like every archived
 * puzzle either side of it.
 */
export const FREEFORM_TRIAL_START = "2026-09-14";
export const FREEFORM_TRIAL_END = MODE_CHOICE_START;

/**
 * Whether `date`'s puzzle is played on the mode the player chose, rather than on
 * the calendar.
 *
 * The one question that separates the trial from the switch, and the reason the
 * dates before it are untouched by any of this.
 */
export function modeIsChosen(date: string): boolean {
  return date >= MODE_CHOICE_START;
}

/**
 * Which mode `date`'s puzzle is played in: the player's choice from the choice
 * date on, and the calendar's before it.
 *
 * The single answer both halves of the game read. Scoring asks it to decide
 * whether a word folds (see `usesFreeformRules` in game/dictionary.ts); the
 * record asks it to decide which key a day's progress is saved under and which
 * board its score belongs on. They have to be the same answer or a player banks
 * a Freeform word onto the Standard board.
 *
 * An undated call is not offered, and the callers that have no date do not want
 * one: the leaderboard prices a stranger's find and the finds feed prices a word
 * from an unknown puzzle, and both of those have always answered with the
 * folding system whatever week it happens to be.
 */
export function modeForDate(date: string): GameMode {
  if (modeIsChosen(date)) return currentMode();
  return date >= FREEFORM_TRIAL_START ? "freeform" : DEFAULT_MODE;
}

/** Whether `date`'s puzzle skips the scoring fold -- see game/dictionary.ts. */
export function freeformForDate(date: string): boolean {
  return modeForDate(date) === "freeform";
}

/** Reset the cached mode. Tests only -- storage is the source either way. */
export function resetModeCache(): void {
  current = null;
}
