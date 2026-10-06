/**
 * Who the leaderboard thinks you are.
 *
 * There are no accounts in this game and this does not add any. The browser
 * mints a random id the first time somebody opens the app and keeps it in
 * localStorage (see src/Root.tsx, which does the minting).
 *
 * Where that happens has moved twice, each time toward less ceremony. It was a
 * button ("Put me on the board"), then the leaderboard visit itself, and now
 * opening the app at all. The reason for the last move is that the earlier
 * ones lost data that had already been earned: a player with no id submits
 * nothing, so somebody who played every day and never tapped the trophy left no
 * trace on the board or in the finds feed, and their whole record hung on a
 * page they had no particular reason to open.
 *
 * The trade is worth stating rather than papering over: every player is on the
 * board now, including one who would not have chosen it. What is stored and
 * sent is an id this browser invented and the words they found -- both of which
 * the leaderboard already shows to everybody -- and none of it reaches back
 * into the game.
 *
 * There is no name to choose. What the board calls a player is derived from this
 * id (see game/handle.ts), so the id is the whole of the stored identity --
 * nothing here is typed, and nothing here is personal.
 *
 * The honest limits, since they are worth stating rather than papering over:
 * clearing site data makes you a new player, and a second browser is a second
 * player. That is the trade for not asking anyone to sign up, and for a
 * leaderboard it is a fine one.
 */

/**
 * Where this browser keeps its identity.
 *
 * Exported for the transfer path (see game/transfer.ts), which moves this key
 * bodily from one browser to another rather than going through `joinBoard` --
 * adopting an id that already exists is the one thing every function below is
 * written to avoid doing by accident, so it cannot be done through them.
 */
export const PLAYER_KEY = "ick:player";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing or disabled storage: the player simply can't be on the
    // board, which must never stop them playing.
    return null;
  }
}

/**
 * A random v4 UUID. `crypto.randomUUID` is not everywhere (older Safari, and
 * any insecure-origin context), so fall back to filling the bytes by hand
 * rather than letting an unsupported browser fail to join.
 */
export function newId(): string {
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
 * The account this player is signed in as, where the host has accounts.
 *
 * Null on this site, which has none. Identity here is a UUID the browser
 * invents and the name on the board is computed from it -- nobody types a name,
 * so nobody can be impersonated. Inside a Reddit post the player already has an
 * account, the server knows which, and the client is told: the id becomes the
 * username, and the board calls them `u/them` rather than inventing a name for
 * somebody who has one.
 */
let account: string | null = null;

/** Play as an account rather than as this browser. Call before rendering. */
export function setAccount(name: string | null): void {
  account = name;
}

/** The account being played as, or null where the browser is the identity. */
export function accountName(): string | null {
  return account;
}

/**
 * This browser's board identity, or null when nobody has joined.
 *
 * The account, where there is one -- and it has to be, for two reasons that are
 * really the same one. The id goes up with every score, and the id is what a
 * board row is matched against to find the player's own. Leave the browser's
 * UUID in place while the server records the account and the player is told
 * they are somebody else, and never shown which row is theirs.
 */
export function loadPlayerId(): string | null {
  if (account) return account;
  const raw = safeGet(PLAYER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

/** Whether this browser is on the board. */
export function hasJoined(): boolean {
  return loadPlayerId() !== null;
}

/**
 * Join the board, minting an id if there isn't one. Idempotent: joining twice
 * keeps the first id, so a player's whole history stays under one identity --
 * which is what lets the caller run it on every open rather than having to know
 * whether this browser has been here before.
 */
export function joinBoard(): string | null {
  // An account needs no minting and nothing stored: it is already an identity,
  // and it is the same one on every device the player signs in from.
  if (account) return account;
  const existing = loadPlayerId();
  if (existing) return existing;
  const id = newId();
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id }));
  } catch {
    // Nothing worth throwing over on the play path: a browser that cannot
    // remember the id cannot be on the board.
    return null;
  }
  return id;
}

/** Leave the board. Rejoining later is joining as somebody new. */
export function leaveBoard(): void {
  try {
    localStorage.removeItem(PLAYER_KEY);
  } catch {
    // Nothing to do -- see safeGet.
  }
}
