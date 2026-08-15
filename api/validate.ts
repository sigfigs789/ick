// Live word-validation fallback: a Vercel Edge Function that asks Merriam-Webster
// whether a word the offline dictionary rejects is nonetheless a real, ordinary,
// current English word. The MW API keys stay server-side here -- they are never
// shipped to the browser. Mirrors the classification in scripts/word_tags.py so
// the live check agrees with the build-time pipeline.
//
// GET /api/validate?word=<lowercase a-z, 1-15 chars>
//   -> { word, valid: boolean, reason: string | null, pos: string[] }
// `valid` is true only when MW attests an ordinary current sense; proper nouns,
// abbreviations, and out-of-use words come back valid:false with the reason.

export const config = { runtime: "edge" };

const MW_NAME_FLS = new Set(["geographical name", "biographical name", "trademark"]);
const MW_ABBR_FLS = new Set(["abbreviation"]);
const MW_STATUS_SEVERITY: Record<string, number> = { obsolete: 3, archaic: 2 };
const DISQUALIFYING = new Set([
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "obsolete",
  "archaic",
  "dated",
]);
const WORD_RE = /^[a-z]{1,15}$/;
const USER_AGENT = "WordInk word-tagger (wordink.app)";

// Only the fields we read from a Merriam-Webster entry; the sense tree under
// `def` is deeply/loosely structured, so it stays `unknown` and is walked with
// runtime guards.
interface MwEntry {
  meta?: { id?: string };
  fl?: string;
  def?: unknown[];
}

/** Highest out-of-use severity among a list of MW status labels (0 = current). */
function statusSeverity(labels: unknown): number {
  if (!Array.isArray(labels)) return 0;
  let max = 0;
  for (const label of labels) {
    const severity = MW_STATUS_SEVERITY[label as string] ?? 0;
    if (severity > max) max = severity;
  }
  return max;
}

/**
 * Out-of-use severity for each sense of an MW entry. A status label can sit on
 * the sense or on the whole definition block (`def[].sls`, which applies to
 * every sense in it -- e.g. "erst"); each sense inherits the stronger of the two.
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
          severities.push(Math.max(blockSeverity, statusSeverity((node[1] as { sls?: unknown }).sls)));
        } else {
          node.forEach(walk);
        }
      } else if (node && typeof node === "object") {
        Object.values(node).forEach(walk);
      }
    };
    walk(block.sseq);
    if (!foundSense) severities.push(blockSeverity);
  }
  return severities;
}

async function fetchMw(reference: string, word: string, key: string): Promise<unknown[]> {
  const url =
    `https://dictionaryapi.com/api/v3/references/${reference}/json/` +
    `${encodeURIComponent(word)}?key=${key}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

type Verdict = "playable" | "unknown" | "proper-noun" | "abbreviation" | "name-or-abbreviation" | "archaic" | "obsolete";

/**
 * Merriam-Webster verdict for a word. Only entries whose headword matches the
 * query count -- MW also returns related words (e.g. "Burr" for "aaron").
 */
async function mwClassify(word: string): Promise<{ verdict: Verdict; pos: string[] }> {
  const lookups: Array<[string, string | undefined]> = [
    ["collegiate", process.env.MW_COLLEGIATE_KEY],
    ["medical", process.env.MW_MEDICAL_KEY],
  ];
  const entries: MwEntry[] = [];
  for (const [reference, key] of lookups) {
    if (!key) continue;
    let data: unknown[] = [];
    try {
      data = await fetchMw(reference, word, key);
    } catch {
      continue; // a source failure is "no opinion", never fatal
    }
    for (const raw of data) {
      if (!raw || typeof raw !== "object") continue; // suggestion strings -> not found
      const entry = raw as MwEntry;
      const stem = String(entry.meta?.id ?? "").split(":")[0];
      if (stem.toLowerCase() === word.toLowerCase()) entries.push(entry);
    }
  }

  if (entries.length === 0) return { verdict: "unknown", pos: [] };

  const pos = new Set<string>();
  let hasOrdinary = false;
  let hasName = false;
  let hasAbbr = false;
  const ordinarySeverities: number[] = [];
  for (const entry of entries) {
    const fl = String(entry.fl ?? "");
    pos.add(fl);
    const stem = String(entry?.meta?.id ?? "").split(":")[0];
    if (MW_ABBR_FLS.has(fl)) {
      hasAbbr = true;
    } else if (MW_NAME_FLS.has(fl) || (stem && stem !== stem.toLowerCase())) {
      hasName = true;
    } else {
      hasOrdinary = true;
      const severities = senseSeverities(entry);
      ordinarySeverities.push(...(severities.length ? severities : [0]));
    }
  }

  const posList = [...pos].sort();
  if (hasOrdinary) {
    if (ordinarySeverities.length && ordinarySeverities.every((s) => s >= 1)) {
      return { verdict: Math.min(...ordinarySeverities) === 2 ? "archaic" : "obsolete", pos: posList };
    }
    return { verdict: "playable", pos: posList };
  }
  if (hasName && hasAbbr) return { verdict: "name-or-abbreviation", pos: posList };
  if (hasName) return { verdict: "proper-noun", pos: posList };
  if (hasAbbr) return { verdict: "abbreviation", pos: posList };
  return { verdict: "unknown", pos: posList };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // MW answers are stable; let the CDN cache them and spare the daily quota.
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const word = (new URL(request.url).searchParams.get("word") ?? "").trim().toLowerCase();
  if (!WORD_RE.test(word)) {
    return json({ word, valid: false, reason: "malformed", pos: [] }, 400);
  }
  if (!process.env.MW_COLLEGIATE_KEY && !process.env.MW_MEDICAL_KEY) {
    // No keys configured -> the fallback is simply unavailable; callers treat
    // this like a normal miss rather than an error the player should see.
    return json({ word, valid: false, reason: "unconfigured", pos: [] }, 503);
  }

  let verdict: Verdict;
  let pos: string[];
  try {
    ({ verdict, pos } = await mwClassify(word));
  } catch {
    return json({ word, valid: false, reason: "unavailable", pos: [] }, 502);
  }

  if (verdict === "playable") return json({ word, valid: true, reason: null, pos });
  if (verdict === "unknown") return json({ word, valid: false, reason: "not-a-word", pos });
  return json({ word, valid: false, reason: DISQUALIFYING.has(verdict) ? verdict : "not-a-word", pos });
}
