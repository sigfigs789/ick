import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDLE_HINT_DELAY_MS,
  assignIdleHintArm,
  forcedIdleHintVariant,
  idleHintExperiment,
  idleHintText,
  idleHintWord,
  type IdleHintArm,
} from "../game/idleHint";
import type { AcceptedWord } from "../game/types";
import {
  isReporting,
  trackIdleHintAssigned,
  trackIdleHintTriggered,
  trackIdleHintTyped,
  trackIdleHintWordSubmitted,
} from "../analytics";
import { playKeystroke } from "../audio/sound";

/** How fast the hint types itself into the placeholder, per character. */
export const IDLE_HINT_TYPE_MS = 70;

interface Options {
  drop: string;
  /** The puzzle being played; no date, no experiment. */
  date?: string;
  /** The words banked on it, which the hint must not repeat. */
  acceptedWords?: readonly AcceptedWord[];
  /** What is in the box right now. */
  value: string;
  disabled: boolean;
}

interface Trigger {
  /** The puzzle it fired on. */
  key: string;
  word: string;
  /** When, in epoch milliseconds. */
  at: number;
  /** The words banked when it fired: banking another retires the hint. */
  answerCount: number;
}

/**
 * Whether a dialog is covering the page -- How to play on a first visit, or any
 * other sheet. Every modal in the app marks itself aria-modal.
 */
function dialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * The idle hint, for the word box (see game/idleHint.ts).
 *
 * Draws the player's arm on mount, then runs the experiment's clock whenever
 * the box is empty, the puzzle is open, no dialog is up and the tab is in view;
 * typing, opening a dialog, hiding the tab or moving to another puzzle starts it
 * over. Focusing the box does not: a player who tapped in and is stuck is the
 * one the hint is for. It fires once per puzzle
 * per page load, in both arms, and only the treatment arm gets a placeholder.
 *
 * Returns the placeholder to show, if any -- typed out a character at a time,
 * with a keystroke sound for each --
 * and `onSubmitted`, which the form calls with every submission so a submitted
 * hint word is counted.
 */
export function useIdleHint({ drop, date, acceptedWords, value, disabled }: Options) {
  const [arm, setArm] = useState<IdleHintArm | null>(null);
  const [visible, setVisible] = useState(pageVisible);
  const [covered, setCovered] = useState(dialogOpen);
  // A forced arm (`?idle-hint=treatment`) is for trying the hint out: it runs
  // without reporting anything, so it never counts towards the experiment.
  const forced = useRef(forcedIdleHintVariant()).current;
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [typedChars, setTypedChars] = useState(0);
  const fired = useRef(new Set<string>());
  const typedReported = useRef<string | null>(null);
  const submitReported = useRef<string | null>(null);
  const accepted = useRef(acceptedWords ?? []);
  accepted.current = acceptedWords ?? [];
  const enabled = date !== undefined && acceptedWords !== undefined;
  const key = `${date}:${drop.toLowerCase()}`;

  // The draw. StrictMode runs this twice, and the second run finds the arm
  // already stored, so the assignment is reported once.
  const assignDate = useRef(date);
  useEffect(() => {
    if (!enabled) return;
    if (forced) {
      setArm({ experiment: idleHintExperiment(), variant: forced });
      return;
    }
    if (!isReporting()) return;
    const drawn = assignIdleHintArm();
    if (!drawn) return;
    if (drawn.fresh && assignDate.current) {
      trackIdleHintAssigned(drawn, assignDate.current);
    }
    setArm({ experiment: drawn.experiment, variant: drawn.variant });
  }, [enabled, forced]);

  useEffect(() => {
    const onChange = () => setVisible(pageVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setCovered(dialogOpen()));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    setCovered(dialogOpen());
    return () => observer.disconnect();
  }, []);

  const empty = value === "";
  useEffect(() => {
    if (!arm || !date || disabled || !empty || !visible || covered) return;
    if (fired.current.has(key)) return;
    const timer = window.setTimeout(() => {
      fired.current.add(key);
      const word = idleHintWord(drop, date, accepted.current);
      // No word to offer is no trigger in either arm, so both arms stay
      // comparable.
      if (!word) return;
      if (!forced) trackIdleHintTriggered(arm, date, word, accepted.current.length);
      setTypedChars(0);
      setTrigger({ key, word: word.word, at: Date.now(), answerCount: accepted.current.length });
    }, IDLE_HINT_DELAY_MS[arm.experiment]);
    return () => window.clearTimeout(timer);
  }, [arm, date, drop, key, disabled, empty, visible, covered, forced]);

  const live = trigger !== null && trigger.key === key ? trigger : null;

  // The first keystroke after the trigger, once per trigger.
  useEffect(() => {
    if (!arm || !date || !live || empty || forced) return;
    const id = `${live.key}:${live.at}`;
    if (typedReported.current === id) return;
    typedReported.current = id;
    trackIdleHintTyped(arm, date, Date.now() - live.at);
  }, [arm, date, live, empty, forced]);

  const shown =
    arm?.variant === "treatment" && live !== null && live.answerCount === (acceptedWords?.length ?? 0)
      ? idleHintText(live.word)
      : null;
  // By code point, so the emoji is typed as one character rather than two.
  const chars = shown === null ? [] : Array.from(shown);
  const fullLength = chars.length;

  // Typed into the placeholder a character at a time, each with the sound of a
  // key going down (a space is typed silently, as a pause between words).
  useEffect(() => {
    if (shown === null || typedChars >= fullLength) return;
    const next = Array.from(shown)[typedChars];
    const timer = window.setTimeout(() => {
      if (next.trim() !== "") playKeystroke();
      setTypedChars((n) => n + 1);
    }, IDLE_HINT_TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [shown, typedChars, fullLength]);

  const onSubmitted = useCallback(
    (raw: string, wasAccepted: boolean) => {
      if (!arm || !date || !live || forced) return;
      const word = raw.trim().toLowerCase();
      if (word !== live.word) return;
      const id = `${live.key}:${live.at}`;
      if (submitReported.current === id) return;
      submitReported.current = id;
      trackIdleHintWordSubmitted(arm, date, word, wasAccepted);
    },
    [arm, date, live, forced]
  );

  return {
    placeholder: shown === null ? null : chars.slice(0, typedChars).join(""),
    onSubmitted,
  };
}
