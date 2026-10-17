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
 * typed into the box's placeholder, a letter at a time, behind an emoji -- an
 * Uncommon or Rare word that contains the drop and that the puzzle would
 * accept. It is a starting point, not a giveaway: those tiers are the middle of
 * the scale, and the player still has to find something rarer to do well.
 *
 * Two experiments, each split 50/50 on its own:
 *   - `new`: a first-ever session. The hint comes after 7 seconds.
 *   - `returning`: any later session. The hint comes after 10 seconds.
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
  returning: 10_000,
};

/** The tiers a hint is drawn from. */
export const IDLE_HINT_TIERS: readonly Rarity[] = ["Uncommon", "Rare"];

/** The emoji the hint is typed behind. */
export const IDLE_HINT_EMOJI = "💡";

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

/**
 * The word to hint for this puzzle: Uncommon or Rare, containing the drop, 5 to
 * 10 letters, scored as itself rather than folded onto a base, and one the
 * puzzle would actually take right now -- run through the same check a
 * submission gets, so it is never a word already banked (or the same root as
 * one), never a reviewed rejection, and never something the chat would refuse
 * as profane or that touches a sensitive stem.
 *
 * The same pick for everybody on the same puzzle with the same words banked,
 * and the same across a reload, so the hint is not a slot machine.
 */
export function idleHintWord(
  drop: string,
  date: string,
  accepted: readonly AcceptedWord[]
): AcceptedWord | undefined {
  const candidates = wordsForDropInTiers(drop, IDLE_HINT_TIERS, date)
    .filter(({ word }) => word.length >= MIN_LETTERS && word.length <= MAX_LETTERS && !SENSITIVE.test(word))
    .map((w) => ({ w, key: hash(`${date}:${drop.toLowerCase()}:${w.word}`) }))
    .sort((a, b) => a.key - b.key);
  for (let i = 0; i < candidates.length && i < MAX_TRIES; i++) {
    const { word } = candidates[i].w;
    if (chatProblem(word) === "profane") continue;
    const result = evaluateSubmission(word, drop, [...accepted], date);
    if (result.ok && result.word && IDLE_HINT_TIERS.includes(result.word.rarity)) {
      return result.word;
    }
  }
  return undefined;
}

/** The placeholder the hint types out, in full: the emoji, then the word. */
export function idleHintText(word: string): string {
  return `${IDLE_HINT_EMOJI} ${word}`;
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
