import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDLE_HINT_DELAY_MS,
  assignIdleHintArm,
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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * The idle hint, for the word box (see game/idleHint.ts).
 *
 * Draws the player's arm on mount, then runs the experiment's clock whenever
 * the box is empty, the puzzle is open and the tab is in view; typing, hiding
 * the tab or moving to another puzzle starts it over. It fires once per puzzle
 * per page load, in both arms, and only the treatment arm gets a placeholder.
 *
 * Returns the placeholder to show, if any -- typed out a character at a time --
 * and `onSubmitted`, which the form calls with every submission so a submitted
 * hint word is counted.
 */
export function useIdleHint({ drop, date, acceptedWords, value, disabled }: Options) {
  const [arm, setArm] = useState<IdleHintArm | null>(null);
  const [visible, setVisible] = useState(pageVisible);
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
    if (!enabled || !isReporting()) return;
    const drawn = assignIdleHintArm();
    if (!drawn) return;
    if (drawn.fresh && assignDate.current) {
      trackIdleHintAssigned(drawn, assignDate.current);
    }
    setArm({ experiment: drawn.experiment, variant: drawn.variant });
  }, [enabled]);

  useEffect(() => {
    const onChange = () => setVisible(pageVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const empty = value === "";
  useEffect(() => {
    if (!arm || !date || disabled || !empty || !visible) return;
    if (fired.current.has(key)) return;
    const timer = window.setTimeout(() => {
      fired.current.add(key);
      const word = idleHintWord(drop, date, accepted.current);
      // No word to offer is no trigger in either arm, so both arms stay
      // comparable.
      if (!word) return;
      trackIdleHintTriggered(arm, date, word, accepted.current.length);
      setTypedChars(prefersReducedMotion() ? Infinity : 0);
      setTrigger({ key, word: word.word, at: Date.now(), answerCount: accepted.current.length });
    }, IDLE_HINT_DELAY_MS[arm.experiment]);
    return () => window.clearTimeout(timer);
  }, [arm, date, drop, key, disabled, empty, visible]);

  const live = trigger !== null && trigger.key === key ? trigger : null;

  // The first keystroke after the trigger, once per trigger.
  useEffect(() => {
    if (!arm || !date || !live || empty) return;
    const id = `${live.key}:${live.at}`;
    if (typedReported.current === id) return;
    typedReported.current = id;
    trackIdleHintTyped(arm, date, Date.now() - live.at);
  }, [arm, date, live, empty]);

  const shown =
    arm?.variant === "treatment" && live !== null && live.answerCount === (acceptedWords?.length ?? 0)
      ? idleHintText(live.word)
      : null;
  // By code point, so the emoji is typed as one character rather than two.
  const chars = shown === null ? [] : Array.from(shown);
  const fullLength = chars.length;

  // Typed into the placeholder a character at a time; reduced motion gets the
  // whole thing at once (typedChars starts at Infinity).
  useEffect(() => {
    if (shown === null || typedChars >= fullLength) return;
    const timer = window.setTimeout(() => setTypedChars((n) => n + 1), IDLE_HINT_TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [shown, typedChars, fullLength]);

  const onSubmitted = useCallback(
    (raw: string, wasAccepted: boolean) => {
      if (!arm || !date || !live) return;
      const word = raw.trim().toLowerCase();
      if (word !== live.word) return;
      const id = `${live.key}:${live.at}`;
      if (submitReported.current === id) return;
      submitReported.current = id;
      trackIdleHintWordSubmitted(arm, date, word, wasAccepted);
    },
    [arm, date, live]
  );

  return {
    placeholder: shown === null ? null : chars.slice(0, typedChars).join(""),
    onSubmitted,
  };
}
