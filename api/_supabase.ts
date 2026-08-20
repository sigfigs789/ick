// Shared Supabase writer for the edge functions.
//
// The leading underscore is deliberate: Vercel does not turn a file in `api/`
// whose name starts with `_` into a route, so this stays a helper module rather
// than becoming an endpoint of its own.
//
// Everything here is best-effort and write-only. Recording is never allowed to
// change what a request answers or how fast it answers: an unconfigured
// deployment silently skips the write, a failing one logs and moves on, and a
// slow one is cut off by SUPABASE_TIMEOUT_MS. The game must keep working
// exactly as it does today whether or not this database exists.

// Vercel's Edge runtime exposes `process.env` for configured secrets. Declared
// locally rather than pulling @types/node in, which would drag Node's globals
// into a runtime that doesn't have them.
declare const process: { env: Record<string, string | undefined> };

const SUPABASE_TIMEOUT_MS = 2000;

/**
 * The Edge runtime hands the handler a context whose `waitUntil` keeps a promise
 * alive after the response is returned. Typed structurally and optionally, since
 * nothing guarantees it is there -- the unit tests call handlers with one
 * argument, and a runtime without it simply falls back to awaiting the write.
 */
export interface EdgeContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Whether this deployment has Supabase credentials at all. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function post(path: string, body: unknown): Promise<void> {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Nothing here reads its writes, so ask PostgREST not to send the rows back.
      prefer: "return=minimal",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`supabase ${response.status}: ${detail.slice(0, 200)}`);
  }
}

/**
 * Record something in Supabase without letting it affect the caller's response.
 *
 * Resolves rather than rejecting on every failure, including an unconfigured
 * deployment. When the runtime provides `waitUntil` the write is handed to it and
 * this returns immediately, so the response is not held up; without it the write
 * is awaited, bounded by its own timeout, so environments that lack `waitUntil`
 * still record rather than dropping the write when the isolate is frozen.
 */
export async function record(path: string, body: unknown, context?: EdgeContext): Promise<void> {
  if (!supabaseConfigured()) return;
  const pending = post(path, body).catch((error: unknown) => {
    // Visible in the Vercel function logs, and nowhere else -- a recording
    // problem is an operator's problem, never the player's.
    console.error(`[supabase] ${path} write failed:`, error instanceof Error ? error.message : error);
  });
  if (context?.waitUntil) {
    context.waitUntil(pending);
    return;
  }
  await pending;
}
