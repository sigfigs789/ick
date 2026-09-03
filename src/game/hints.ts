import hintCopy from "../data/hint-copy.json";
import hintData from "../data/hints.json";

/**
 * Which hint a drop teaches.
 *
 * `middle`, `end` and `start` state where the rarest words put the drop -- a
 * claim, so `scripts/generate-hints.py` only assigns one to a drop whose rare
 * words actually concentrate there. The rest are techniques that hold on any
 * drop, for the drops with no positional tendency worth stating.
 */
export type HintKey =
  | "middle"
  | "end"
  | "start"
  | "walk"
  | "room"
  | "who"
  | "sound"
  | "second";

const KEYS: Record<string, string | undefined> = hintData;
const COPY: Record<string, string | undefined> = hintCopy;

/**
 * The hint for `drop`, or undefined for a drop with no hint.
 *
 * Undefined is a real answer rather than a fallback. The generator leaves out
 * any drop whose every candidate hint would name a word worth submitting for
 * it, and such a drop shows no hint and no button -- honest, where generic
 * filler would not be. It is also what an unknown drop gets.
 *
 * Positional copy takes the drop because a hint has to name what it is talking
 * about: the player sees three letters in a box, so "rarest words don't end
 * here" has no referent on screen.
 */
export function hintForDrop(drop: string): string | undefined {
  const upper = drop.toUpperCase();
  const key = KEYS[upper];
  if (key === undefined) return undefined;
  const template = COPY[key];
  if (template === undefined) return undefined;
  return template.replace("{drop}", upper);
}
