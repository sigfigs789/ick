// Folds rejected live at /folded-live, per puzzle. See api/folded-live.ts.
//
// The one piece of scoring that is not shipped in the bundle. Everything else
// the fold knows is dated data in src/data, so a puzzle scores the same on every
// device forever; a rejection here is written by a person on a page and reaches
// players the next time they open that puzzle. It can only ever do one thing --
// stop a fold on one puzzle, so the word scores on its own frequency -- and the
// scoring asks this registry exactly that (see `adjustedZipf` in dictionary.ts).
//
// Imports nothing from dictionary.ts, which imports this: the registry is a
// table of strings, and the scoring is what knows what to do with it.

const FETCH_TIMEOUT_MS = 6000;

/** One rejected fold: the word, and the form it had been scored as. */
export interface LiveFoldRejection {
  word: string;
  base: string;
}

/** What has been read, per puzzle date: word -> the base it had folded to. */
const registry = new Map<string, Map<string, string>>();

/** Whether `word`'s fold was rejected live on `date`'s puzzle. */
export function liveFoldRejected(word: string, date?: string): boolean {
  if (date === undefined) return false;
  return registry.get(date)?.has(word) ?? false;
}

/** Every rejection known for `date`'s puzzle. */
export function liveFoldRejectionsFor(date: string): LiveFoldRejection[] {
  const day = registry.get(date);
  if (!day) return [];
  return [...day].map(([word, base]) => ({ word, base }));
}

/** Replace what is known for one puzzle. Exported for the tests as well. */
export function setLiveFoldRejections(date: string, rejections: readonly LiveFoldRejection[]): void {
  registry.set(date, new Map(rejections.map((r) => [r.word, r.base])));
}

/** Forget everything, for the tests. */
export function clearLiveFoldRejections(): void {
  registry.clear();
}

/**
 * Read one puzzle's rejections and keep them, so the scoring sees them.
 *
 * Rejects on failure; the game swallows that (a player on a bad connection keeps
 * the scores they had) and the page says it. `fresh` skips the CDN's shared copy,
 * for the page that has just written to it.
 */
export async function fetchLiveFoldRejections(
  date: string,
  options: { fresh?: boolean } = {}
): Promise<LiveFoldRejection[]> {
  const fresh = options.fresh ? `&t=${Date.now()}` : "";
  const response = await fetch(`/api/folded-live?date=${encodeURIComponent(date)}${fresh}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`folded-live ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const rejections = parseRejections(body.rejections);
  setLiveFoldRejections(date, rejections);
  return rejections;
}

/**
 * Reject a fold on one puzzle, or take the rejection back. Answers with what is
 * stored, and keeps the registry in step with it.
 */
export async function setLiveFoldRejection(
  date: string,
  rejection: LiveFoldRejection,
  rejected: boolean
): Promise<boolean> {
  const response = await fetch("/api/folded-live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, ...rejection, rejected }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`folded-live ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const stored = body.rejected === true;
  const day = registry.get(date) ?? new Map<string, string>();
  if (stored) day.set(rejection.word, rejection.base);
  else day.delete(rejection.word);
  registry.set(date, day);
  return stored;
}

function parseRejections(raw: unknown): LiveFoldRejection[] {
  if (!Array.isArray(raw)) return [];
  const rejections: LiveFoldRejection[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { word, base } = entry as Record<string, unknown>;
    if (typeof word !== "string" || !word || typeof base !== "string" || !base) continue;
    rejections.push({ word, base });
  }
  return rejections;
}
