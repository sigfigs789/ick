/**
 * Where `/api/...` goes when there is no page it is relative to.
 *
 * The game's network clients -- the live dictionary lookup
 * (`src/game/liveValidate.ts`) and the leaderboard
 * (`src/game/leaderboard.ts`) -- ask for root-relative paths, which on the
 * website resolve against the page they are served from. An app has no such
 * page: `fetch("/api/validate")` on a device is a URL with no host and throws.
 *
 * Rather than thread a base URL through shared code for the benefit of one
 * host, the platform's `fetch` is wrapped to resolve those paths itself. It is
 * the same move as the storage shim next door, for the same reason: the game
 * is written against the web's primitives, and this is the layer that supplies
 * them.
 *
 * ## Which host
 *
 * The live site. There is no separate app backend and there should not be one:
 * both endpoints are the website's, the leaderboard is deliberately one board
 * across every front-end the game has (the Reddit build imports from this same
 * host for exactly that reason), and the dictionary verdicts are a cache the
 * website has already paid for.
 *
 * Overridable from `app.json`'s `extra.apiOrigin` so a build can be pointed at
 * a preview deployment without a code change.
 */
import Constants from 'expo-constants';

/** The website, and the default for every build. */
const DEFAULT_API_ORIGIN = 'https://www.wordink.app';

function configuredOrigin(): string {
  const extra = Constants.expoConfig?.extra as { apiOrigin?: unknown } | undefined;
  const origin = extra?.apiOrigin;
  return typeof origin === 'string' && origin.length > 0 ? origin : DEFAULT_API_ORIGIN;
}

export const API_ORIGIN = configuredOrigin();

/**
 * Resolve root-relative request paths against the site, and leave everything
 * else exactly as it was.
 *
 * Only paths beginning with a single `/` are touched. An absolute URL is
 * already addressed, and a protocol-relative `//host/path` names a host of its
 * own -- neither is this shim's business, and quietly rewriting either would
 * make a request go somewhere its caller did not ask for.
 *
 * Idempotent, because fast refresh re-runs the module and wrapping the wrapper
 * would grow a chain of them across a session.
 */
export function installFetchBaseUrl(): void {
  const global = globalThis as typeof globalThis & { __wordinkFetchWrapped?: boolean };
  if (global.__wordinkFetchWrapped) return;
  global.__wordinkFetchWrapped = true;

  const original = globalThis.fetch;

  globalThis.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')) {
      return original(API_ORIGIN + input, init);
    }
    return original(input, init);
  } as typeof fetch;
}

/** A path on the site, as a full URL -- for the app's own links and requests. */
export function siteUrl(path: string): string {
  return API_ORIGIN + path;
}
