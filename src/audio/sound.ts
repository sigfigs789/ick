import type { Rarity } from "../game/types";

// Synthesized with the Web Audio API rather than shipped as audio files --
// keeps the bundle small and means there's nothing to load/decode before
// the first sound can play.

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;

/**
 * Browsers refuse to start audio before a user gesture, so the context is
 * created (and resumed) lazily on first use rather than at module load --
 * by the time this is called we're already inside a click/submit handler.
 */
function getContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface ToneOptions {
  type?: OscillatorType;
  peakGain?: number;
  glideTo?: number;
}

function tone(c: AudioContext, freq: number, startTime: number, duration: number, opts: ToneOptions = {}) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, startTime);
  if (opts.glideTo) {
    osc.frequency.exponentialRampToValueAtTime(opts.glideTo, startTime + duration);
  }
  const peak = opts.peakGain ?? 0.15;
  // Short exponential attack/decay envelope so notes click on/off cleanly
  // instead of clicking (a hard on/off step is audible as a pop).
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

const RARITY_RANK: Record<Rarity, number> = {
  Quotidian: 0,
  "Very Common": 1,
  Common: 2,
  Uncommon: 3,
  Rare: 4,
  "Extremely Rare": 5,
  Elusive: 6,
  Mythic: 7,
  Legend: 8,
};

// The sparkle note is the audible "you found something good" cue, so it keys off
// the winning threshold (Rare and up) rather than a bare number.
const SPARKLE_MIN_RANK = RARITY_RANK.Rare;

/** A short rising two-note chime. Rarer words are pitched a little higher and get an extra sparkle note. */
export function playAccept(rarity: Rarity): void {
  const c = getContext();
  if (!c) return;
  const now = c.currentTime;
  const rank = RARITY_RANK[rarity];
  const base = 520 + rank * 55;
  tone(c, base, now, 0.11, { peakGain: 0.16 });
  tone(c, base * 1.5, now + 0.09, 0.16, { peakGain: 0.14 });
  if (rank >= SPARKLE_MIN_RANK) {
    tone(c, base * 2, now + 0.17, 0.16, { type: "triangle", peakGain: 0.1 });
  }
}

/** A short, low, descending buzz -- deliberately unobtrusive, not punishing. */
export function playReject(): void {
  const c = getContext();
  if (!c) return;
  tone(c, 180, c.currentTime, 0.16, { type: "square", peakGain: 0.07, glideTo: 110 });
}

/** A small four-note major arpeggio for completing the puzzle. */
export function playComplete(): void {
  const c = getContext();
  if (!c) return;
  const now = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => tone(c, freq, now + i * 0.1, 0.24, { peakGain: 0.15 }));
}
