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

/**
 * The context for a sound nobody pressed anything to hear -- a chat message
 * arriving -- or null before the player has touched the page. A context made
 * or resumed without a gesture stays suspended, and whatever was scheduled on
 * it would play late, all at once, on their first tap.
 */
function unpromptedContext(): AudioContext | null {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  return getContext();
}

/** A soft two-note "bloop" for another player's message in the chat. */
export function playChatMessage(): void {
  const c = unpromptedContext();
  if (!c) return;
  const now = c.currentTime;
  tone(c, 659.25, now, 0.09, { peakGain: 0.08 }); // E5
  tone(c, 880, now + 0.07, 0.14, { peakGain: 0.07 }); // A5
}

/**
 * A brighter three-note twinkle for a notice the room posts itself -- a new top
 * score or a 9.5+ word -- so it is told apart from a player's message by ear.
 */
export function playChatNotice(): void {
  const c = unpromptedContext();
  if (!c) return;
  const now = c.currentTime;
  const notes = [783.99, 1046.5, 1318.51]; // G5 C6 E6
  notes.forEach((freq, i) => tone(c, freq, now + i * 0.07, 0.16, { type: "triangle", peakGain: 0.07 }));
}

/**
 * A crowd's applause, one size for each window a winner is named for.
 *
 * A week's is a room clapping: a handful of hands for a little over a second.
 * A month's is the bigger thing it marks -- more than twice the crowd, clapping
 * for twice as long and a little louder, with a fanfare rising under it -- so
 * the two are told apart by ear before the name is read.
 */
const APPLAUSE = {
  week: { clappers: 6, duration: 1.3, peakGain: 0.12, fanfare: false },
  month: { clappers: 16, duration: 2.6, peakGain: 0.16, fanfare: true },
} as const;

let noise: AudioBuffer | null = null;

/**
 * A tenth of a second of white noise, made once and replayed for every clap --
 * each one is a different stretch of it through a different filter, which is
 * enough that no two claps sound alike.
 */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const length = Math.floor(c.sampleRate * 0.1);
  noise = c.createBuffer(1, length, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** One pair of hands meeting: a burst of noise, band-passed and gone in ~50ms. */
function clap(c: AudioContext, startTime: number, peak: number, pitch: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = pitch;
  filter.Q.value = 1.2;
  const gain = c.createGain();
  const decay = 0.035 + Math.random() * 0.03;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(startTime, Math.random() * 0.04, decay + 0.01);
}

/**
 * One key of a keyboard going down: a short, bright tick of noise over a soft
 * low knock, a little different each time so a run of them sounds like hands
 * typing rather than a metronome. For the idle hint typing itself out, which
 * nobody pressed anything to start, so it stays quiet before the first tap.
 */
export function playKeystroke(): void {
  const c = unpromptedContext();
  if (!c) return;
  const now = c.currentTime;
  clap(c, now, 0.05 + Math.random() * 0.03, 2500 + Math.random() * 1500);
  tone(c, 140 + Math.random() * 40, now, 0.03, { type: "triangle", peakGain: 0.03 });
}

/** Applause for the winner of the week or month that just closed. */
export function playApplause(closed: "week" | "month"): void {
  const c = getContext();
  if (!c) return;
  const now = c.currentTime;
  const { clappers, duration, peakGain, fanfare } = APPLAUSE[closed];
  // Each clapper keeps their own pace and pitch, which is what turns a pile of
  // noise bursts into a crowd rather than a drum machine.
  for (let i = 0; i < clappers; i++) {
    const interval = 0.2 + Math.random() * 0.12;
    const pitch = 900 + Math.random() * 1600;
    // Somebody always starts first and the room joins in.
    let t = now + Math.random() * 0.25;
    while (t < now + duration) {
      const progress = (t - now) / duration;
      // Swells in quickly and thins out, the way applause does; the gain is
      // shared across clappers so a bigger crowd is fuller, not just louder.
      const swell = Math.min(1, progress * 6) * (1 - progress) ** 1.5;
      const level = (peakGain * swell * (0.6 + Math.random() * 0.4)) / Math.sqrt(clappers);
      if (level > 0.001) clap(c, t, level, pitch);
      t += interval * (0.85 + Math.random() * 0.3);
    }
  }
  if (fanfare) {
    // A G-major arpeggio held at the top -- a step up from the C the
    // puzzle-complete chime plays, so it reads as more than finishing a day.
    const notes = [392.0, 493.88, 587.33, 783.99]; // G4 B4 D5 G5
    notes.forEach((freq, i) =>
      tone(c, freq, now + i * 0.11, i === notes.length - 1 ? 0.7 : 0.26, {
        type: "triangle",
        peakGain: 0.11,
      }),
    );
  }
}
