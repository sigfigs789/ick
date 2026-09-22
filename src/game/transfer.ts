import { PLAYER_KEY } from "./player";
import { PROGRESS_PREFIX, STREAK_KEY } from "./storage";

/**
 * Moving a player from one browser to another.
 *
 * There are no accounts here, so there is nothing to sign into on a second
 * device -- a new browser mints a new id and is a new player, which is the
 * honest trade `game/player.ts` describes and does not apologise for. This is
 * the one deliberate exception: a player who *is* somebody else already, on a
 * phone they have just started using, saying so.
 *
 * What moves is the whole of the stored record and nothing besides:
 *
 *   - `ick:player`, which is the entire identity. The name on the board is a
 *     pure function of it (game/handle.ts), so carrying the id carries the
 *     name, the board row, and every score ever filed under it.
 *   - `ick:streak`, the counters and the all-time high score.
 *   - every `ick:progress:<date>`, one per day played.
 *
 * Everything else under the `ick:` prefix stays put. `ick:seen:*`, `ick:visits`
 * and the rest are facts about a browser -- whether *this* screen has shown the
 * instructions yet -- and carrying them across would mean a player arriving on a
 * new phone to find the game already convinced it had explained itself.
 *
 * Days move as raw strings rather than parsed and re-serialised. A save is a
 * record of a puzzle played on its own terms, `loadProgress` already migrates
 * old tier names on the way in, and a transfer that reshaped a year of history
 * would be running those migrations twice for no gain and one new way to be
 * wrong. Bytes in, bytes out; the receiving browser reads them exactly as it
 * reads its own.
 *
 * The payload rides in the URL *hash*, which is the reason this works as a link
 * at all and the reason it is safe to send as one: a fragment is never put on
 * the wire. It does not reach the server, so it cannot land in a Vercel log, a
 * CDN cache key, or a referrer header on the way to anywhere else. The id in it
 * is effectively a password -- anyone holding it can file scores as that player
 * -- and a query string would have published it to every hop in between.
 *
 * Nothing here is authenticated, and it cannot be: the id is the credential and
 * the credential is the thing being moved. What the receiving page does instead
 * is refuse to act silently -- see components/TransferPage.tsx, which names the
 * player being adopted and the one being left behind, and waits to be told to
 * go ahead. A link that rewrote an identity on tap would be a link worth
 * sending to somebody else.
 */

/**
 * The payload version, carried so a browser can refuse a shape it does not
 * know rather than half-applying it.
 *
 * A link is a thing people keep. One made today may well be opened after this
 * format has moved on, and "this transfer link is too old, make a new one" is a
 * far better outcome than a partial restore nobody notices.
 */
export const TRANSFER_VERSION = 1;

/** What a transfer carries. Raw stored strings, keyed as they are stored. */
export interface TransferPayload {
  v: number;
  /** The player id being moved: the whole of the identity. */
  id: string;
  /** `ick:streak` verbatim, absent on a browser that has never played. */
  streak?: string;
  /** Date (`YYYY-MM-DD`) to that day's stored progress, verbatim. */
  progress: Record<string, string>;
}

/** What a decoded payload amounts to, for a page that has to describe it. */
export interface TransferSummary {
  id: string;
  days: number;
  /** The earliest and latest day in the payload, or null when there are none. */
  first: string | null;
  last: string | null;
}

/** A player id is a UUID and nothing else. Anything else is not a transfer. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ceilings on what will be decoded, because the input is a URL a stranger can
 * write. Neither is reachable by a real player: the game began in 2026-07 and
 * one day's save is a few hundred bytes, so a decade of daily play is inside
 * both. They exist so that a hostile link fails fast rather than filling a
 * phone's storage quota with junk under this app's origin.
 */
const MAX_DAYS = 4000;
const MAX_BYTES = 4 * 1024 * 1024;

/** Compressed or not: the first character of an encoded payload says which. */
const GZIP = "1";
const PLAIN = "0";

/**
 * Everything this browser would hand to another, or null when there is nothing
 * to hand over -- a browser with no id is not a player and has nothing to move.
 */
export function collectTransfer(): TransferPayload | null {
  let keys: string[];
  let id: string | null;
  try {
    id = readKey(PLAYER_KEY);
    keys = Object.keys(localStorage);
  } catch {
    // Private browsing or storage switched off. Nothing is stored, so there is
    // nothing to transfer, which is not an error worth raising at the caller.
    return null;
  }
  if (!id) return null;
  const parsedId = idFrom(id);
  if (!parsedId) return null;

  const progress: Record<string, string> = {};
  for (const key of keys) {
    if (!key.startsWith(PROGRESS_PREFIX)) continue;
    const date = key.slice(PROGRESS_PREFIX.length);
    if (!DATE_RE.test(date)) continue;
    const raw = readKey(key);
    if (raw) progress[date] = raw;
  }

  const streak = readKey(STREAK_KEY);
  return {
    v: TRANSFER_VERSION,
    id: parsedId,
    ...(streak ? { streak } : {}),
    progress,
  };
}

/** What a payload amounts to in the three numbers a page needs to describe it. */
export function summarise(payload: TransferPayload): TransferSummary {
  const dates = Object.keys(payload.progress).sort();
  return {
    id: payload.id,
    days: dates.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

/**
 * A payload as the string that goes after the `#`.
 *
 * Gzipped where the browser has `CompressionStream`, which every current one
 * does and Safari has since 16.4. A year of saves is extremely repetitive JSON
 * -- the same keys and the same nine rarity names over and over -- so this is
 * worth roughly five to one, which is the difference between a link that pastes
 * into a message and one that does not.
 *
 * The fallback is the same JSON uncompressed rather than a refusal: a long link
 * still works, and a browser too old to compress is exactly the browser most
 * likely to be the one somebody is trying to move *off*.
 */
export async function encodeTransfer(payload: TransferPayload): Promise<string> {
  const json = JSON.stringify(payload);
  const packed = await gzip(json);
  if (packed) return GZIP + toBase64Url(packed);
  return PLAIN + toBase64Url(new TextEncoder().encode(json));
}

/**
 * The payload a hash carries, or null when it carries anything else.
 *
 * Every failure is the same null: a truncated link, a link mangled by a
 * messaging app, a link from a future version, and a link somebody wrote by
 * hand to see what would happen. The page says "this link didn't work" to all
 * of them, because there is nothing the reader could usefully do differently.
 */
export async function decodeTransfer(encoded: string): Promise<TransferPayload | null> {
  const trimmed = encoded.replace(/^#/, "").trim();
  if (trimmed.length < 2) return null;
  const scheme = trimmed[0];
  if (scheme !== GZIP && scheme !== PLAIN) return null;

  const bytes = fromBase64Url(trimmed.slice(1));
  if (!bytes || bytes.length > MAX_BYTES) return null;

  let json: string;
  try {
    const raw = scheme === GZIP ? await gunzip(bytes) : bytes;
    if (!raw || raw.length > MAX_BYTES) return null;
    json = new TextDecoder().decode(raw);
  } catch {
    return null;
  }

  return validate(json);
}

/**
 * Whether a decoded string is a transfer this browser will act on.
 *
 * Deliberately strict, because the source is a URL and the sink is this app's
 * own localStorage. A day is kept only when it parses, is an object, and agrees
 * with the key it arrived under -- so a payload cannot smuggle a save for one
 * date in under another, and cannot put anything in storage that the game's own
 * loader would then have to survive reading.
 */
function validate(json: string): TransferPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const { v, id, streak, progress } = parsed as Record<string, unknown>;
  if (v !== TRANSFER_VERSION) return null;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (streak !== undefined && typeof streak !== "string") return null;
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return null;
  if (streak !== undefined && !isJsonObject(streak)) return null;

  const entries = Object.entries(progress as Record<string, unknown>);
  if (entries.length > MAX_DAYS) return null;

  const kept: Record<string, string> = {};
  for (const [date, raw] of entries) {
    if (!DATE_RE.test(date)) return null;
    if (typeof raw !== "string") return null;
    let day: unknown;
    try {
      day = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!day || typeof day !== "object" || Array.isArray(day)) return null;
    // The save has to say it is the day it is filed under. Without this a
    // payload could write one puzzle's words over every date in the calendar.
    if ((day as { date?: unknown }).date !== date) return null;
    if (!Array.isArray((day as { acceptedWords?: unknown }).acceptedWords)) return null;
    kept[date] = raw;
  }

  return {
    v: TRANSFER_VERSION,
    id,
    ...(typeof streak === "string" ? { streak } : {}),
    progress: kept,
  };
}

/** Whether a stored string is a JSON object, which is all `ick:streak` may be. */
function isJsonObject(raw: string): boolean {
  try {
    const value = JSON.parse(raw);
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Become the player in the payload, on this browser.
 *
 * Additive rather than a replacement: days already stored here that the payload
 * does not mention are left alone, and a day in both takes the incoming one.
 * The usual case is a browser that has never played, where the distinction does
 * not arise -- but where it does, keeping the local days is the safe direction.
 * They are real play, the board's per-day write is monotonic (`greatest(...)`
 * in the leaderboard migration), and the next `syncHistory` files them under
 * the adopted id, which can only ever raise a day there and never lower one.
 *
 * The id is written last. Every other key is inert until something claims it,
 * and a half-finished transfer that has taken the new identity but not the
 * history would file an empty record under it; this way a failure part-way
 * leaves a browser that is still its old self with some extra saves, which is
 * recoverable by opening the same link again.
 *
 * Returns false when storage refuses -- a full quota, or private browsing --
 * because that is a thing the page has to say rather than swallow. Everything
 * else in this app treats unwritable storage as "you simply can't be on the
 * board"; here it is the entire operation failing.
 */
export function applyTransfer(payload: TransferPayload): boolean {
  try {
    for (const [date, raw] of Object.entries(payload.progress)) {
      localStorage.setItem(PROGRESS_PREFIX + date, raw);
    }
    if (payload.streak) localStorage.setItem(STREAK_KEY, payload.streak);
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: payload.id }));
    return true;
  } catch {
    return false;
  }
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The id inside a stored `ick:player`, or null when it holds anything else. */
function idFrom(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id !== "string" || !ID_RE.test(parsed.id)) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

async function gzip(text: string): Promise<Uint8Array | null> {
  const Compression = globalThis.CompressionStream;
  if (typeof Compression !== "function") return null;
  try {
    const stream = new Compression("gzip");
    feed(stream.writable, new TextEncoder().encode(text));
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Decompression = globalThis.DecompressionStream;
  if (typeof Decompression !== "function") return null;
  const stream = new Decompression("gzip");
  feed(stream.writable, bytes);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/**
 * Push one buffer through a transform stream and close it.
 *
 * The writer's own promises are swallowed deliberately, and this exists so that
 * swallowing them is done in one place with a reason attached. A truncated
 * payload -- the ordinary way a pasted link fails -- errors the stream, which
 * rejects the write, the close, *and* the read. Only the read is awaited, so
 * the other two would be unhandled rejections: noise in a browser console and
 * a failed test run, for a failure that is already being reported properly by
 * the side that is actually being read.
 */
function feed(writable: WritableStream<Uint8Array>, bytes: Uint8Array): void {
  const writer = writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
}

/**
 * Base64url, so the payload survives being a URL fragment and being pasted into
 * a message: no `+`, no `/`, and no `=` for something to helpfully strip.
 *
 * Chunked through `fromCharCode` because spreading a megabyte of bytes into one
 * call overflows the argument stack -- which is exactly the size this is for.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
