/**
 * Hosts on Vercel's own domain: preview deployments and the project's
 * `*.vercel.app` aliases. The people playing there are the people building the
 * game, so nothing they do belongs in the analytics or on the leaderboard.
 *
 * Shared by the client, which turns reporting off on these hosts (src/main.tsx),
 * and the endpoints that write analytics and scores (api/events.ts,
 * api/leaderboard.ts), which drop what arrives on one -- the guarantee, since a
 * preview built before this check still posts.
 */
const VERCEL_HOST_RE = /(^|\.)vercel\.app$/i;

export function isVercelHost(hostname: string | null | undefined): boolean {
  return !!hostname && VERCEL_HOST_RE.test(hostname);
}

/** Whether a request was made to a Vercel-domain host. */
export function isVercelRequest(request: Request): boolean {
  try {
    return isVercelHost(new URL(request.url).hostname);
  } catch {
    return false;
  }
}
