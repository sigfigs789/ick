import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  IDLE_HINT_DELAY_MS,
  IDLE_HINT_GAP_MS,
  IDLE_HINT_HOLD_MS,
  IDLE_HINT_ROUNDS,
  idleHintExperiment,
  idleHintPool,
  idleHintText,
  idleHintWords,
} from '../../../src/game/idleHint';
import type { AcceptedWord } from '../../../src/game/types';

/** How fast the hint types itself into the placeholder, per character. */
const IDLE_HINT_TYPE_MS = 120;
/** How fast it is erased, per character: a held-down backspace is quicker than typing. */
const IDLE_HINT_ERASE_MS = 90;
/** Where the website waits for an idle callback, a beat to let the board paint first. */
const POOL_DELAY_MS = 1_500;

interface Options {
  drop: string;
  /** The puzzle being played; no date, no hint. */
  date?: string;
  /** The words banked on it, which the hint must not repeat. */
  acceptedWords?: readonly AcceptedWord[];
  /** What is in the box right now. */
  value: string;
  disabled: boolean;
  /**
   * Whether a sheet is covering the screen -- How to play on a first open, or
   * any other. The website finds out by looking for an `aria-modal` element;
   * there is no document to look in here, so the screen says.
   */
  covered?: boolean;
}

type Phase = 'typing' | 'holding' | 'erasing' | 'waiting' | 'over';

interface Loop {
  /** The puzzle it fired on. */
  key: string;
  /** The words it types, in order (fewer than three only on a thin drop). */
  words: readonly string[];
  /** How many hints have been typed and erased so far. */
  done: number;
  phase: Phase;
  /** How much of the current hint is in the placeholder. */
  chars: number;
  /** The player typed: the loop is over for this puzzle. */
  stopped: boolean;
}

/** How long the box sits empty first. Both experiments wait the same today. */
function idleDelay(): number {
  try {
    return IDLE_HINT_DELAY_MS[idleHintExperiment()];
  } catch {
    return IDLE_HINT_DELAY_MS.new;
  }
}

/**
 * The idle hint, for the word box: the website's src/hooks/useIdleHint.ts,
 * for a host with no document.
 *
 * The website runs it as an experiment; the app is always its treatment arm
 * and reports nothing, as the Reddit post does. The rhythm is the same, from
 * the same helpers (src/game/idleHint.ts): once the box has sat empty for
 * the delay, with the puzzle open, nothing covering it and the app in the
 * foreground, a hint is typed into the placeholder a character at a time,
 * held for 2s and erased a character at a time; 1s later the next one, three
 * hints in all, and then it is over. A sheet or the app going to the
 * background pauses it. The first character the player types ends it for the
 * puzzle, for as long as the app stays open. Focusing the box does not: a
 * player who tapped in and is stuck is the one the hint is for.
 *
 * The website plays a keystroke sound per character; the app types in
 * silence -- a buzz per letter would be a phone vibrating in a pocket for
 * fifteen seconds.
 *
 * Returns the placeholder to show, if any.
 */
export function useIdleHint({
  drop,
  date,
  acceptedWords,
  value,
  disabled,
  covered = false,
}: Options): string | null {
  const [visible, setVisible] = useState(() => AppState.currentState === 'active');
  const [loop, setLoop] = useState<Loop | null>(null);
  const fired = useRef(new Set<string>());
  const accepted = useRef(acceptedWords ?? []);
  useEffect(() => {
    accepted.current = acceptedWords ?? [];
  }, [acceptedWords]);
  const enabled = date !== undefined && acceptedWords !== undefined;
  const key = `${date}:${drop.toLowerCase()}`;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setVisible(state === 'active')
    );
    return () => subscription.remove();
  }, []);

  // The hint words cost a scan of the whole dictionary, so it is done while
  // the player is still reading the board, not when the clock runs out.
  useEffect(() => {
    if (!enabled || !date) return;
    const timer = setTimeout(() => idleHintPool(drop, date), POOL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, date, drop]);

  const empty = value === '';
  const live = loop !== null && loop.key === key ? loop : null;
  const started = live !== null;

  useEffect(() => {
    if (!enabled || !date || disabled || !empty || !visible || covered || started) return;
    if (fired.current.has(key)) return;
    const timer = setTimeout(() => {
      fired.current.add(key);
      const words = idleHintWords(drop, date, accepted.current);
      if (words.length === 0) return;
      setLoop({
        key,
        words: words.map((w) => w.word),
        done: 0,
        phase: 'typing',
        chars: 0,
        stopped: false,
      });
    }, idleDelay());
    return () => clearTimeout(timer);
  }, [enabled, date, drop, key, disabled, empty, visible, covered, started]);

  // The first character typed ends the loop. Set during render rather than
  // from an effect, so the hint is never painted over the first letter.
  if (live && !live.stopped && !empty) setLoop({ ...live, stopped: true });

  const running = live !== null && !live.stopped && !disabled && visible && !covered;
  const text = live === null ? '' : idleHintText(live.words[live.done % live.words.length]);

  // One step of the loop at a time; a pause just leaves the step's timer unset.
  useEffect(() => {
    if (!running || live === null) return;
    // By code point, so nothing outside the basic plane is typed as two halves.
    const letters = Array.from(text);
    const step = (ms: number, next: Partial<Loop>) => {
      const timer = setTimeout(() => {
        setLoop((l) => (l === null || l.key !== live.key ? l : { ...l, ...next }));
      }, ms);
      return () => clearTimeout(timer);
    };
    switch (live.phase) {
      case 'typing':
        if (live.chars >= letters.length) return step(0, { phase: 'holding' });
        return step(IDLE_HINT_TYPE_MS, { chars: live.chars + 1 });
      case 'holding':
        return step(IDLE_HINT_HOLD_MS, { phase: 'erasing' });
      case 'erasing':
        if (live.chars <= 0) {
          return step(0, {
            phase: live.done + 1 >= IDLE_HINT_ROUNDS ? 'over' : 'waiting',
            done: live.done + 1,
          });
        }
        return step(IDLE_HINT_ERASE_MS, { chars: live.chars - 1 });
      case 'waiting':
        return step(IDLE_HINT_GAP_MS, { phase: 'typing', chars: 0 });
      case 'over':
        return;
    }
  }, [running, live, text]);

  return live !== null && !live.stopped && live.chars > 0
    ? Array.from(text).slice(0, live.chars).join('')
    : null;
}
