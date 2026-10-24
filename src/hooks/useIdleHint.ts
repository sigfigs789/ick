import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDLE_HINT_DELAY_MS,
  IDLE_HINT_GAP_MS,
  IDLE_HINT_HOLD_MS,
  IDLE_HINT_ROUNDS,
  assignIdleHintArm,
  forcedIdleHintVariant,
  idleHintExperiment,
  idleHintPool,
  idleHintText,
  idleHintWords,
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
export const IDLE_HINT_TYPE_MS = 120;
/** How fast it is erased, per character: a held-down backspace is quicker than typing. */
export const IDLE_HINT_ERASE_MS = 90;

interface Options {
  drop: string;
  /** The puzzle being played; no date, no experiment. */
  date?: string;
  /** The words banked on it, which the hint must not repeat. */
  acceptedWords?: readonly AcceptedWord[];
  /** What is in the box right now. */
  value: string;
  disabled: boolean;
  /** Whether the box has focus. */
  focused?: boolean;
}

type Phase = "typing" | "holding" | "erasing" | "waiting" | "over";

interface Loop {
  /** The puzzle it fired on. */
  key: string;
  /** The words it types, in order (fewer than three only on a thin drop). */
  words: readonly string[];
  /** When it fired, in epoch milliseconds. */
  at: number;
  /** How many hints have been typed and erased so far. */
  done: number;
  phase: Phase;
  /** How much of the current hint is in the placeholder. */
  chars: number;
  /** The player typed or focused the box: the loop is over for this puzzle. */
  stopped: boolean;
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

/** Runs `work` when the main thread is free, or after a beat where it can't tell. */
function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout: 3_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 1_500);
  return () => window.clearTimeout(id);
}

/**
 * The idle hint, for the word box (see game/idleHint.ts).
 *
 * Draws the player's arm on mount, then runs the experiment's clock whenever
 * the box is empty, the puzzle is open, no dialog is up and the tab is in view;
 * typing, opening a dialog, hiding the tab or moving to another puzzle starts it
 * over. Focusing the box ends it for the puzzle instead: a player who tapped in
 * is already finding their own way in, and a hint typed over them is in the way.
 *
 * When the clock runs out the loop starts, in both arms (only treatment sees
 * it): a hint is typed into the placeholder a character at a time, each with a
 * keystroke sound, held for 2s and erased a character at a time; 1s later the
 * next one, three hints in all, and then it is over. A dialog or a hidden tab
 * pauses it. The first character the player types, or focusing the box, ends
 * it for the puzzle, for this page load.
 *
 * Returns the placeholder to show, if any, and `onSubmitted`, which the form
 * calls with every submission so a submitted hint word is counted.
 */
export function useIdleHint({ drop, date, acceptedWords, value, disabled, focused = false }: Options) {
  const [arm, setArm] = useState<IdleHintArm | null>(null);
  const [visible, setVisible] = useState(pageVisible);
  const [covered, setCovered] = useState(dialogOpen);
  // A forced arm (`?idle-hint=treatment`) is for trying the hint out: it runs
  // without reporting anything, so it never counts towards the experiment.
  const forced = useRef(forcedIdleHintVariant()).current;
  const [loop, setLoop] = useState<Loop | null>(null);
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
    // A host that reports nothing has no experiment for a draw to count
    // towards -- a Vercel preview is the people building the game, trying it
    // out -- so it gets the hint, the way the Reddit post and the app do.
    if (!isReporting()) {
      setArm({ experiment: idleHintExperiment(), variant: "treatment" });
      return;
    }
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

  // The hint words cost a scan of the whole dictionary, so it is done while
  // the player is still reading the board, not when the clock runs out.
  useEffect(() => {
    if (!arm || !date) return;
    return whenIdle(() => idleHintPool(drop, date));
  }, [arm, date, drop]);

  const empty = value === "";
  const live = loop !== null && loop.key === key ? loop : null;
  const started = live !== null;

  // Focusing the box ends the hint for the puzzle, in both arms so they stay
  // comparable: a clock that has not run out never will, and a loop that has
  // started stops where it is.
  useEffect(() => {
    if (!focused) return;
    fired.current.add(key);
    if (live && !live.stopped) setLoop({ ...live, stopped: true });
  }, [focused, key, live]);

  useEffect(() => {
    if (!arm || !date || disabled || !empty || !visible || covered || started || focused) return;
    if (fired.current.has(key)) return;
    const timer = window.setTimeout(() => {
      fired.current.add(key);
      const words = idleHintWords(drop, date, accepted.current);
      // No word to offer is no trigger in either arm, so both arms stay
      // comparable.
      if (words.length === 0) return;
      if (!forced) trackIdleHintTriggered(arm, date, words, accepted.current.length);
      setLoop({
        key,
        words: words.map((w) => w.word),
        at: Date.now(),
        done: 0,
        phase: "typing",
        chars: 0,
        stopped: false,
      });
    }, IDLE_HINT_DELAY_MS[arm.experiment]);
    return () => window.clearTimeout(timer);
  }, [arm, date, drop, key, disabled, empty, visible, covered, forced, started, focused]);

  // The first character typed ends the loop, and is reported once -- also when
  // focusing the box ended it a moment earlier, as it does for anyone who types.
  useEffect(() => {
    if (!live || empty) return;
    if (!live.stopped) setLoop({ ...live, stopped: true });
    if (!arm || !date || forced) return;
    const id = `${live.key}:${live.at}`;
    if (typedReported.current === id) return;
    typedReported.current = id;
    trackIdleHintTyped(arm, date, Date.now() - live.at);
  }, [arm, date, live, empty, forced]);

  const shows = arm?.variant === "treatment";
  const running = live !== null && !live.stopped && !disabled && visible && !covered;
  const text = live === null ? "" : idleHintText(live.words[live.done % live.words.length]);
  // By code point, so nothing outside the basic plane is typed as two halves.
  const chars = Array.from(text);

  // One step of the loop at a time; a pause just leaves the step's timer unset.
  useEffect(() => {
    if (!running || live === null) return;
    const letters = Array.from(text);
    const step = (ms: number, next: Partial<Loop>, sound = false) => {
      const timer = window.setTimeout(() => {
        if (sound && shows) playKeystroke();
        setLoop((l) => (l === null || l.key !== live.key ? l : { ...l, ...next }));
      }, ms);
      return () => window.clearTimeout(timer);
    };
    switch (live.phase) {
      case "typing":
        if (live.chars >= letters.length) return step(0, { phase: "holding" });
        return step(IDLE_HINT_TYPE_MS, { chars: live.chars + 1 }, true);
      case "holding":
        return step(IDLE_HINT_HOLD_MS, { phase: "erasing" });
      case "erasing":
        if (live.chars <= 0) {
          return step(0, { phase: live.done + 1 >= IDLE_HINT_ROUNDS ? "over" : "waiting", done: live.done + 1 });
        }
        return step(IDLE_HINT_ERASE_MS, { chars: live.chars - 1 }, true);
      case "waiting":
        return step(IDLE_HINT_GAP_MS, { phase: "typing", chars: 0 });
      case "over":
        return;
    }
  }, [running, live, text, shows]);

  const onSubmitted = useCallback(
    (raw: string, wasAccepted: boolean) => {
      if (!arm || !date || !live || forced) return;
      const word = raw.trim().toLowerCase();
      // Any hint the loop had reached, in either arm.
      const reached = live.words.slice(0, Math.min(live.done + 1, live.words.length));
      if (!reached.includes(word)) return;
      const id = `${live.key}:${live.at}`;
      if (submitReported.current === id) return;
      submitReported.current = id;
      trackIdleHintWordSubmitted(arm, date, word, wasAccepted);
    },
    [arm, date, live, forced]
  );

  const placeholder = shows && !focused && live !== null && !live.stopped && live.chars > 0 ? chars.slice(0, live.chars).join("") : null;
  return { placeholder, onSubmitted };
}
