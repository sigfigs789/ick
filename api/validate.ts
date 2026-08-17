// Live word-validation fallback: a Vercel Edge Function that asks
// Merriam-Webster whether a word the offline dictionary rejected is nonetheless
// a real, ordinary, current English word -- and, when it is, asks Datamuse for a
// frequency so the word can be scored on the same Zipf scale as every curated
// word instead of falling back to the unattested floor.
//
// The MW API keys stay server-side here; they are never shipped to the browser.
// Responses are CDN-cached so a repeated lookup of the same word costs nothing
// against MW's 1,000-requests-per-day non-commercial quota.
//
// GET /api/validate?word=<lowercase a-z>
//   -> { word, outcome, reason, zipf, pos, firstUse, ... }
//
// `outcome` is one of:
//   "playable"  MW attests an ordinary, current, inoffensive sense.
//   "rejected"  MW knows it but the game shouldn't take it (proper noun,
//               abbreviation, archaic/obsolete, offensive); `reason` says which.
//   "unknown"   MW has no matching entry -- the original rejection stands.
//   "error"     the lookup itself failed; `reason` and `detail` say why, and the
//               caller reports it rather than drawing any conclusion about the word.

export const config = { runtime: "edge" };

// Vercel's Edge runtime exposes `process.env` for configured secrets. Declared
// locally rather than pulling @types/node in, which would drag Node's globals
// into a runtime that doesn't have them.
declare const process: { env: Record<string, string | undefined> };

/** Functional labels that mark an entry as a name rather than an ordinary word. */
const MW_NAME_FLS = new Set(["geographical name", "biographical name", "trademark"]);
const MW_ABBR_FLS = new Set(["abbreviation"]);
// Out-of-use status labels, ranked so the mildest register wins when a word's
// senses disagree (see `outOfUseVerdict`).
const MW_STATUS_SEVERITY: Record<string, number> = { obsolete: 3, archaic: 2 };

// The game's own input rule: English letters only, no upper length cap beyond
// the input's own, so long real words ("gastroenterologist") stay eligible.
const WORD_RE = /^[a-z]{2,30}$/;
const USER_AGENT = "WordInk live word check (wordink.app)";
// Upstream calls are bounded so the function can't hang; the client has already
// stopped waiting after 1s, but a wedged request would still burn quota.
const UPSTREAM_TIMEOUT_MS = 5000;

type Outcome = "playable" | "rejected" | "unknown" | "error";

/** Why a word MW knows about still isn't playable. Mirrors the game's reasons. */
type RejectReason = "proper-noun" | "abbreviation" | "name-or-abbreviation" | "archaic" | "obsolete" | "offensive";

interface LiveCheckBody {
  word: string;
  outcome: Outcome;
  /** Reject reason, or the failure reason when `outcome` is "error". */
  reason: RejectReason | string | null;
  /** Free-text failure detail, only on errors. */
  detail?: string;
  /** Upstream HTTP status, only on errors that came from an upstream response. */
  status?: number;
  /** Measured Zipf frequency, or null when no source attests one. */
  zipf: number | null;
  /** MW functional labels (parts of speech) for the matching entries. */
  pos: string[];
  /** MW's first-known-use date, e.g. "1961" or "12th century". */
  firstUse: string | null;
  /** Which MW reference answered: "collegiate", "medical", or null on a miss. */
  source?: string | null;
}

// Only the fields we read from an MW entry. The sense tree under `def` is deeply
// and loosely structured, so it stays `unknown` and is walked with runtime guards.
interface MwEntry {
  meta?: { id?: string; offensive?: boolean };
  fl?: string;
  date?: string;
  def?: unknown[];
}

/** An upstream call that failed in a way worth naming in the failure event. */
class UpstreamError extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
    readonly status?: number
  ) {
    super(`${reason}: ${detail}`);
  }
}

/**
 * MW's prose fields carry inline markup tokens -- the `date` for "cat" really is
 * `"before 12th century{ds||1|a|}"`. Strip the tokens so the reported first-use
 * date is readable in an analytics event.
 */
function stripMwMarkup(text: string): string {
  return text.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
}

/** Highest out-of-use severity among a list of MW status labels (0 = current). */
function statusSeverity(labels: unknown): number {
  if (!Array.isArray(labels)) return 0;
  let max = 0;
  for (const label of labels) {
    const severity = MW_STATUS_SEVERITY[String(label).toLowerCase()] ?? 0;
    if (severity > max) max = severity;
  }
  return max;
}

/**
 * Out-of-use severity for each sense of an MW entry. A status label can sit on
 * an individual sense or on the whole definition block (`def[].sls`, which
 * applies to every sense inside it -- this is where "erst"'s archaic label
 * lives); each sense inherits the stronger of the two.
 */
function senseSeverities(entry: MwEntry): number[] {
  const severities: number[] = [];
  for (const rawBlock of entry.def ?? []) {
    const block = (rawBlock ?? {}) as { sls?: unknown; sseq?: unknown };
    const blockSeverity = statusSeverity(block.sls);
    let foundSense = false;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        if (node.length === 2 && node[0] === "sense" && node[1] && typeof node[1] === "object") {
          foundSense = true;
          const sense = node[1] as { sls?: unknown };
          severities.push(Math.max(blockSeverity, statusSeverity(sense.sls)));
        } else {
          node.forEach(walk);
        }
      } else if (node && typeof node === "object") {
        Object.values(node).forEach(walk);
      }
    };
    walk(block.sseq);
    // A block with no parsable senses still carries its own label.
    if (!foundSense) severities.push(blockSeverity);
  }
  return severities;
}

/**
 * Classify an upstream failure so the client's failure event can name it.
 * MW answers an exhausted quota and a bad key with the same 403, distinguished
 * only by the body text, so the body decides between them.
 */
function classifyMwFailure(status: number, body: string): UpstreamError {
  const text = body.slice(0, 200);
  if (status === 403 || status === 429) {
    if (/exceed|limit|quota|too many/i.test(text)) {
      return new UpstreamError("quota-exceeded", text || `HTTP ${status}`, status);
    }
    if (/invalid api key|not for use/i.test(text)) {
      return new UpstreamError("invalid-key", text || `HTTP ${status}`, status);
    }
    // A 403 MW didn't explain is far more likely the daily cap than anything
    // else, but say so honestly rather than asserting it.
    return new UpstreamError("forbidden", text || `HTTP ${status}`, status);
  }
  return new UpstreamError("upstream-error", text || `HTTP ${status}`, status);
}

async function fetchJson(url: string, source: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new UpstreamError(
      aborted ? "upstream-timeout" : "network-error",
      `${source}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw classifyMwFailure(response.status, body);
  }
  try {
    return await response.json();
  } catch {
    throw new UpstreamError("bad-response", `${source}: response was not JSON`, response.status);
  }
}

async function fetchMw(reference: string, word: string, key: string): Promise<unknown[]> {
  const url =
    `https://dictionaryapi.com/api/v3/references/${reference}/json/` +
    `${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  const data = await fetchJson(url, `mw-${reference}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Datamuse reports a word's frequency per million words as an `f:` tag, which is
 * exactly the quantity wordfreq's Zipf scale is built from -- so
 * `log10(perMillion) + 3` puts a live word on the same scale as every word in
 * rarity.json, and it can be scored by the game's normal formula.
 *
 * Datamuse's `sp=` is a *pattern* match and happily answers with a near miss
 * (asking for "abrasure" returns "abrasive"), so only an exact headword match
 * counts. Returns null when nothing attests a frequency, which leaves the word
 * at the game's unattested floor.
 */
async function fetchZipf(word: string): Promise<number | null> {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=f&max=5`;
  const data = await fetchJson(url, "datamuse");
  if (!Array.isArray(data)) return null;
  for (const raw of data) {
    const entry = (raw ?? {}) as { word?: unknown; tags?: unknown };
    if (String(entry.word ?? "").toLowerCase() !== word) continue;
    if (!Array.isArray(entry.tags)) continue;
    for (const tag of entry.tags) {
      const match = /^f:([0-9.]+)$/.exec(String(tag));
      if (!match) continue;
      const perMillion = Number(match[1]);
      if (!Number.isFinite(perMillion) || perMillion <= 0) continue;
      return Math.log10(perMillion) + 3;
    }
  }
  return null;
}

interface Classification {
  outcome: Exclude<Outcome, "error">;
  reason: RejectReason | null;
  pos: string[];
  firstUse: string | null;
}

/**
 * Decide whether MW's entries make this word playable. Only entries whose
 * headword matches the query count -- MW also answers with related words and
 * cross-references (asking for "chile" returns the country "Chile" too).
 */
function classify(entries: MwEntry[]): Classification {
  if (entries.length === 0) {
    return { outcome: "unknown", reason: null, pos: [], firstUse: null };
  }

  const pos = new Set<string>();
  let firstUse: string | null = null;
  let hasOrdinary = false;
  let hasName = false;
  let hasAbbr = false;
  let offensive = false;
  const ordinarySeverities: number[] = [];

  for (const entry of entries) {
    const fl = String(entry.fl ?? "");
    if (fl) pos.add(fl);
    if (entry.meta?.offensive) offensive = true;
    const stem = String(entry.meta?.id ?? "").split(":")[0];

    if (MW_ABBR_FLS.has(fl)) {
      hasAbbr = true;
    } else if (MW_NAME_FLS.has(fl) || (stem && stem !== stem.toLowerCase())) {
      // A capitalized headword is a proper noun even when MW's functional label
      // is an ordinary part of speech.
      hasName = true;
    } else {
      hasOrdinary = true;
      const severities = senseSeverities(entry);
      ordinarySeverities.push(...(severities.length ? severities : [0]));
      // MW's first-known-use date, taken from an ordinary sense only.
      if (!firstUse && entry.date) firstUse = stripMwMarkup(entry.date) || null;
    }
  }

  const posList = [...pos].sort();
  // The game already curates offensive words out of the shipped list; a live
  // lookup must not be a way around that.
  if (offensive) {
    return { outcome: "rejected", reason: "offensive", pos: posList, firstUse };
  }

  if (hasOrdinary) {
    // Out of use only when *every* ordinary sense is, matching the build-time
    // pipeline's per-sense rule. The mildest register wins, so a word with both
    // an obsolete and an archaic sense reports "archaic".
    if (ordinarySeverities.length > 0 && ordinarySeverities.every((s) => s >= 2)) {
      const mildest = Math.min(...ordinarySeverities);
      return {
        outcome: "rejected",
        reason: mildest === 2 ? "archaic" : "obsolete",
        pos: posList,
        firstUse,
      };
    }
    return { outcome: "playable", reason: null, pos: posList, firstUse };
  }

  if (hasName && hasAbbr) {
    return { outcome: "rejected", reason: "name-or-abbreviation", pos: posList, firstUse };
  }
  if (hasName) return { outcome: "rejected", reason: "proper-noun", pos: posList, firstUse };
  if (hasAbbr) return { outcome: "rejected", reason: "abbreviation", pos: posList, firstUse };
  return { outcome: "unknown", reason: null, pos: posList, firstUse };
}

function json(body: LiveCheckBody, status = 200, cacheable = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // A word's dictionary status is stable, so let the CDN answer repeat
      // lookups and spare the daily quota. Failures are never cached -- a
      // transient outage or an exhausted quota must not stick to a word.
      "cache-control": cacheable
        ? "public, s-maxage=86400, stale-while-revalidate=604800"
        : "no-store",
    },
  });
}

function errorBody(word: string, error: UpstreamError): LiveCheckBody {
  return {
    word,
    outcome: "error",
    reason: error.reason,
    detail: error.detail,
    ...(error.status === undefined ? {} : { status: error.status }),
    zipf: null,
    pos: [],
    firstUse: null,
  };
}

export default async function handler(request: Request): Promise<Response> {
  const word = (new URL(request.url).searchParams.get("word") ?? "").trim().toLowerCase();
  if (!WORD_RE.test(word)) {
    return json(
      { word, outcome: "error", reason: "malformed", zipf: null, pos: [], firstUse: null },
      400,
      false
    );
  }

  const keys: Array<[string, string | undefined]> = [
    ["collegiate", process.env.MW_COLLEGIATE_KEY],
    ["medical", process.env.MW_MEDICAL_KEY],
  ];
  const configured = keys.filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (configured.length === 0) {
    return json(
      { word, outcome: "error", reason: "unconfigured", zipf: null, pos: [], firstUse: null },
      503,
      false
    );
  }

  // The references are consulted in order and the first one that actually has
  // the word decides. Collegiate is the general-English authority, so it is
  // asked first; Medical is only reached for a word Collegiate has never heard
  // of (like "piloerection"). Each reference has its own daily quota, so
  // stopping early means an ordinary word costs one request rather than two.
  const entries: MwEntry[] = [];
  let source: string | null = null;
  for (const [reference, key] of configured) {
    let data: unknown[];
    try {
      data = await fetchMw(reference, word, key);
    } catch (error) {
      // Quota and key problems are reported, not swallowed -- silently treating
      // them as "no opinion" is exactly how a broken lookup goes unnoticed.
      if (error instanceof UpstreamError) return json(errorBody(word, error), 502, false);
      throw error;
    }
    for (const raw of data) {
      // A miss comes back as an array of spelling-suggestion strings.
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as MwEntry;
      const stem = String(entry.meta?.id ?? "").split(":")[0];
      if (stem.toLowerCase() === word) entries.push(entry);
    }
    if (entries.length > 0) {
      source = reference;
      break;
    }
  }

  const classification = classify(entries);
  if (classification.outcome !== "playable") {
    return json({
      word,
      outcome: classification.outcome,
      reason: classification.reason,
      zipf: null,
      pos: classification.pos,
      firstUse: classification.firstUse,
      source,
    });
  }

  // The word is playable; try for a real frequency so it scores on a gradient
  // rather than at the unattested floor. A frequency lookup that fails is not
  // fatal -- the word is still playable, just unattested.
  let zipf: number | null = null;
  try {
    zipf = await fetchZipf(word);
  } catch {
    zipf = null;
  }

  return json({
    word,
    outcome: "playable",
    reason: null,
    zipf,
    pos: classification.pos,
    firstUse: classification.firstUse,
    source,
  });
}
