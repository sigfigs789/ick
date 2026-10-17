import { wordsForDropInTiers } from "./dictionary";
import { evaluateSubmission } from "./submit";
import { chatProblem } from "./chat";
import { isReturningSession } from "./visits";
import type { AcceptedWord, Rarity } from "./types";

/**
 * The idle hint: an A/B test of nudging a player who has sat on the play page
 * without typing.
 *
 * When the word box stays empty for a while, the treatment arm sees a word
 * typed into the box's placeholder, a letter at a time behind "...", held,
 * then erased a letter at a time -- and a second later another, three in all:
 * Common or Very Common words that contain the drop and that the puzzle would
 * accept (see `useIdleHint` for the rhythm). They are a way in, not a
 * giveaway: those are the bottom of the scale, and the player still has to
 * find something rarer to do well. The first keystroke ends the loop.
 *
 * Two experiments, each split 50/50 on its own, both hinted after 7 seconds:
 *   - `new`: a first-ever session.
 *   - `returning`: any later session.
 *
 * A player is placed in each experiment the first time they reach the play page
 * as that kind of player, and keeps the arm for good. The two draws are
 * independent, so a new player's arm says nothing about the arm they get once
 * they come back -- each experiment stays a clean 50/50 of its own players.
 *
 * Both arms run the same clock and report the same `idle_hint_triggered` event
 * when it runs out; the control arm just doesn't see anything. That is what
 * makes the comparison fair: most players type within seconds and never reach
 * the threshold, so the players worth comparing are the ones who sat idle long
 * enough to have been shown the hint, in either arm (see the idle_hint_report
 * migration, which reads the experiment off those events).
 */

export type IdleHintExperiment = "new" | "returning";
export type IdleHintVariant = "control" | "treatment";

export interface IdleHintArm {
  experiment: IdleHintExperiment;
  variant: IdleHintVariant;
}

/** How long the box has to sit empty, per experiment. */
export const IDLE_HINT_DELAY_MS: Record<IdleHintExperiment, number> = {
  new: 7_000,
  returning: 7_000,
};

/** The tiers a hint is drawn from. */
export const IDLE_HINT_TIERS: readonly Rarity[] = ["Very Common", "Common"];

/** How many hints a puzzle gets, each a different word where the drop has enough. */
export const IDLE_HINT_ROUNDS = 3;

/** What each hint is typed behind. */
export const IDLE_HINT_PREFIX = "...";

/** How long a typed hint stays up before it is erased. */
export const IDLE_HINT_HOLD_MS = 2_000;

/** The empty box between one hint being erased and the next being typed. */
export const IDLE_HINT_GAP_MS = 1_000;

const ASSIGNMENT_KEY = "ick:idle-hint";

type Assignments = Partial<Record<IdleHintExperiment, IdleHintVariant>>;

function isVariant(value: unknown): value is IdleHintVariant {
  return value === "control" || value === "treatment";
}

function loadAssignments(): Assignments | null {
  try {
    const raw = localStorage.getItem(ASSIGNMENT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const stored = parsed as Record<string, unknown>;
    const out: Assignments = {};
    if (isVariant(stored.new)) out.new = stored.new;
    if (isVariant(stored.returning)) out.returning = stored.returning;
    return out;
  } catch {
    // Unreadable storage cannot hold an arm, and a player re-drawn on every
    // open is not in an experiment.
    return null;
  }
}

/** Which experiment this session belongs to. */
export function idleHintExperiment(): IdleHintExperiment {
  return isReturningSession() ? "returning" : "new";
}

/**
 * This session's arm, if the player has one already. Never assigns -- the
 * analytics events that carry the arm read it through here.
 */
export function currentIdleHintArm(): IdleHintArm | null {
  const experiment = idleHintExperiment();
  const variant = loadAssignments()?.[experiment];
  return variant ? { experiment, variant } : null;
}

/**
 * This session's arm, drawing one if the player has none for this experiment.
 * `fresh` is true only on the draw itself, so the caller reports it once.
 * Null when storage cannot keep the draw: that browser stays out of the test.
 */
export function assignIdleHintArm(
  random: () => number = Math.random
): (IdleHintArm & { fresh: boolean }) | null {
  const experiment = idleHintExperiment();
  const assignments = loadAssignments();
  if (!assignments) return null;
  const existing = assignments[experiment];
  if (existing) return { experiment, variant: existing, fresh: false };
  const variant: IdleHintVariant = random() < 0.5 ? "treatment" : "control";
  try {
    localStorage.setItem(ASSIGNMENT_KEY, JSON.stringify({ ...assignments, [experiment]: variant }));
  } catch {
    return null;
  }
  return { experiment, variant, fresh: true };
}

/** FNV-1a, for an order that is stable per puzzle without being alphabetical. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** How many candidates are put through the full submission check before giving up. */
const MAX_TRIES = 40;

/** Long enough to be a find, short enough to fit the box on a phone. */
const MIN_LETTERS = 5;
const MAX_LETTERS = 10;

/**
 * Stems a hint stays away from. The chat's profanity check catches swearing and
 * slurs, but a suggestion typed into a stranger's box needs a wider berth than a
 * word a player chose for themselves: the puzzle accepts `erotically` and
 * `nippled`, and the game should not be the one proposing them.
 */
const SENSITIVE =
  /(erot|nippl|porn|orgasm|genital|penis|vagin|semen|sperm|whore|bitch|incest|rapist|suicid|murder|corpse|nazi|cocaine|heroin)|^(sex|nude|naked|rape|breast|anus|anal(?!y)|kill|slave)/;

const pools = new Map<string, AcceptedWord[]>();

/**
 * Every word a hint for this puzzle could be, in a stable per-puzzle order and
 * before the words already banked are checked: Common or Very Common,
 * containing the drop, 5 to 10 letters, scored as itself rather than folded onto a base, and
 * clear of the sensitive stems.
 *
 * It scans the whole dictionary (up to ~300ms for a drop like IN), so it is
 * memoised per puzzle and the hook builds it in an idle callback well before
 * the hint is due, rather than on the main thread the moment an idle player
 * might start typing.
 */
export function idleHintPool(drop: string, date: string): readonly AcceptedWord[] {
  const key = `${date}:${drop.toLowerCase()}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = wordsForDropInTiers(drop, IDLE_HINT_TIERS, date)
      .filter(({ word }) => word.length >= MIN_LETTERS && word.length <= MAX_LETTERS && !SENSITIVE.test(word))
      .map((w) => ({ w, key: hash(`${key}:${w.word}`) }))
      .sort((a, b) => a.key - b.key)
      .map(({ w }) => w);
    pools.set(key, pool);
  }
  return pool;
}

/**
 * The words to hint for this puzzle, in the order they are shown: up to three
 * from the pool that the puzzle would actually take right now -- each run
 * through the same check a submission gets, against the words banked and the
 * hints picked before it, so none is a word already banked, the same root as
 * one or as another hint, a reviewed rejection, or something the chat would
 * refuse as profane.
 *
 * The same picks for everybody on the same puzzle with the same words banked,
 * and the same across a reload, so the hint is not a slot machine. Every drop
 * has at least one; 98% have three.
 */
export function idleHintWords(
  drop: string,
  date: string,
  accepted: readonly AcceptedWord[]
): AcceptedWord[] {
  const pool = idleHintPool(drop, date);
  const picked: AcceptedWord[] = [];
  for (let i = 0; i < pool.length && i < MAX_TRIES && picked.length < IDLE_HINT_ROUNDS; i++) {
    const { word } = pool[i];
    if (chatProblem(word) === "profane") continue;
    const result = evaluateSubmission(word, drop, [...accepted, ...picked], date);
    if (result.ok && result.word && IDLE_HINT_TIERS.includes(result.word.rarity)) {
      picked.push(result.word);
    }
  }
  return picked;
}

/** The placeholder a hint types out, in full. */
export function idleHintText(word: string): string {
  return `${IDLE_HINT_PREFIX}${word}`;
}

/**
 * An arm forced with `?idle-hint=treatment` (or `=control`), for trying the
 * hint out without waiting on a coin flip. A forced arm is never stored or
 * reported, so it cannot leak into the experiment's numbers.
 */
export function forcedIdleHintVariant(search: string = window.location.search): IdleHintVariant | null {
  const value = new URLSearchParams(search).get("idle-hint");
  return isVariant(value) ? value : null;
}
