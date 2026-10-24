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

/** A failed `rpc`, carrying PostgREST's status so a caller can tell why. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Whether an `rpc` failed because the function is not on the project at all --
 * PostgREST's 404, which is what an unapplied migration looks like.
 */
export function rpcMissing(error: unknown): boolean {
  return error instanceof RpcError && error.status === 404;
}

/**
 * Call a Postgres function and read its result.
 *
 * The one read path in this module, and deliberately the only one: everything
 * else here is write-only so the game keeps working with no database at all.
 * The leaderboard cannot be write-only -- other people's scores are the entire
 * feature -- so it gets a reader, and it stays behind a `stable` SQL function
 * rather than a table query, which keeps the shape of the read fixed on the
 * server side.
 *
 * Unlike `record`, this rejects on failure: a caller that asked for data has to
 * know it didn't get any, and /api/leaderboard turns that into a response the
 * client shows as "couldn't load" rather than an empty board, which would read
 * as "nobody has played".
 */
export async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  /** Longer for a read nobody is waiting on mid-puzzle, like the analytics reports. */
  timeoutMs = SUPABASE_TIMEOUT_MS,
): Promise<T> {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RpcError(`supabase ${fn} ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }
  return (await response.json()) as T;
}

/**
 * Record something in Supabase without letting it affect the caller's response.
 *
 * Resolves rather than rejecting on every failure, including an unconfigured
 * deployment. When the runtime provides `waitUntil` the write is handed to it and
 * this returns immediately; without it the returned promise settles only when the
 * write does, so a caller on a path a player is waiting on must not await it (see
 * api/validate.ts). Recording is always downstream of the answer.
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
