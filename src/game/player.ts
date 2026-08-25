/**
 * Who the leaderboard thinks you are.
 *
 * There are no accounts in this game and this does not add any. A player who
 * wants on the board types a name; the browser mints a random id to go with it
 * and both live in localStorage. Nothing is sent anywhere until that name
 * exists, so a player who never opts in never appears on the board and never
 * has a row written for them.
 *
 * The honest limits, since they are worth stating rather than papering over:
 * clearing site data makes you a new player, a second browser is a second
 * player, and a name is not reserved -- two people may pick the same one. That
 * is the trade for not asking anyone to sign up, and for a leaderboard it is a
 * fine one.
 */

const PLAYER_KEY = "ick:player";

/** Room for a first name, a handle, or a short joke, and not much else. */
export const MAX_NAME_LENGTH = 18;
export const MIN_NAME_LENGTH = 2;

export interface Player {
  /** Anonymous, browser-local identity. Not tied to any account. */
  id: string;
  name: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing or disabled storage: the player simply can't be on the
    // board, which must never stop them playing.
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // As above -- nothing here is worth an exception on the play path.
  }
}

/**
 * A random v4 UUID. `crypto.randomUUID` is not everywhere (older Safari, and
 * any insecure-origin context), so fall back to filling the bytes by hand
 * rather than letting an unsupported browser fail to join.
 */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  // Version 4, variant 1, exactly as randomUUID would produce.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Characters a display name may not contain: C0 and C1 controls, the
 * zero-width and bidi-override range, and the byte-order mark. All of them are
 * either invisible or capable of reordering the text around them, and a board
 * of other people's names is exactly where that would be used.
 */
// Matching control characters is the point of this pattern, so the rule that
// normally catches them by accident is off for it.
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Trim a typed name to what the board will accept: one line, no runs of
 * whitespace, nothing invisible, capped in length. Returns null when nothing
 * usable is left, which is what the join form treats as "not yet".
 *
 * Deliberately permissive about which letters -- players who write their name
 * in a non-Latin script should be able to. What it does not allow is a name
 * that could pass itself off as the page's own text.
 */
export function normalizeName(raw: string): string | null {
  const cleaned = raw
    .replace(INVISIBLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned.length >= MIN_NAME_LENGTH ? cleaned : null;
}

/** The player on this browser, or null when nobody has joined the board. */
export function loadPlayer(): Player | null {
  const raw = safeGet(PLAYER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Player>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return null;
    const name = normalizeName(parsed.name);
    if (!parsed.id || !name) return null;
    return { id: parsed.id, name };
  } catch {
    return null;
  }
}

/**
 * Join the board, or rename. The id is minted once and kept for good, so a
 * rename carries the player's whole history with it rather than starting a
 * second entry. Returns null when the name isn't usable.
 */
export function savePlayerName(raw: string): Player | null {
  const name = normalizeName(raw);
  if (!name) return null;
  const player: Player = { id: loadPlayer()?.id ?? newId(), name };
  safeSet(PLAYER_KEY, JSON.stringify(player));
  return player;
}

/** Leave the board. The id goes too: rejoining is joining as somebody new. */
export function forgetPlayer(): void {
  try {
    localStorage.removeItem(PLAYER_KEY);
  } catch {
    // Nothing to do -- see safeGet.
  }
}
