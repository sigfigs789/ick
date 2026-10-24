/**
 * A tag a known visitor brings in the URL as `?visitor=<name>`, so the
 * analytics can tell that visitor apart from the players.
 *
 * Today there is one: Muse AI, an agent the maintainer sends to play the game,
 * which arrives as `?visitor=mos-muse`. The analytics page leaves its browsers
 * out of every player number and reports them in a section of their own (see
 * the 2026-10-22 analytics_muse migration).
 *
 * Kept in local storage once seen, because the tag is only on the first URL:
 * moving to another page drops the query, and a return visit to the bare
 * address is still the same visitor. Rides on every event the game
 * logs to its own table (see eventLog.ts).
 */

const VISITOR_KEY = "ick:visitor";

let cached: string | null | undefined;

/** A tag is the same kind of token as a campaign code: short, lowercase, plain. */
function sanitize(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(cleaned) ? cleaned : null;
}

/**
 * This browser's visitor tag, or null for a player. A tag in `search` is
 * stored and wins over an earlier one.
 */
export function visitorTag(search: string = safeSearch()): string | null {
  const fromUrl = sanitize(new URLSearchParams(search).get("visitor"));
  if (fromUrl) {
    cached = fromUrl;
    try {
      localStorage.setItem(VISITOR_KEY, fromUrl);
    } catch {
      // Storage off: the tag still holds for this page load.
    }
    return fromUrl;
  }
  if (cached === undefined) {
    try {
      cached = sanitize(localStorage.getItem(VISITOR_KEY));
    } catch {
      cached = null;
    }
  }
  return cached;
}

function safeSearch(): string {
  try {
    return location.search;
  } catch {
    return "";
  }
}

/** Forgets the cached tag, for tests. */
export function resetVisitorTagForTest(): void {
  cached = undefined;
}
