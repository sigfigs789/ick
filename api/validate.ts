// Live word-validation fallback: a Vercel Edge Function that asks
// Merriam-Webster whether a word the offline dictionary rejected is nonetheless
// a real, ordinary, current English word -- and, when it is, asks Datamuse for a
// frequency so the word can be scored on the same Zipf scale as every curated
// word instead of falling back to the unattested floor.
//
// Two dictionary tiers, in this order:
//   1. MW Collegiate + Medical, queried together and pooled (see the handler).
//      MW is authoritative wherever it has an entry, because it is the only
//      source here with structured per-sense status labels, name/abbreviation
//      functional labels and an `offensive` flag -- every rejection reason the
//      game shows is built on those.
//   2. Wordnik, but *only* when MW has no matching entry at all. That is exactly
//      the case that would otherwise be rejected, so it is pure coverage: AHD
//      and WordNet attest plenty of specialist vocabulary Collegiate omits.
//      Running it last also keeps Wordnik's free plan off the common path, which
//      matters more than it does for MW: a free key measures 5 lookups a minute
//      and 200 an hour, so it is the burstiest allowance of the three.
//
// The API keys stay server-side here; they are never shipped to the browser.
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

// Wordnik aggregates five dictionaries and only two of them can be trusted on
// their own. AHD and WordNet are professionally edited and current. Century
// (1889-1911) and GCIDE/Webster (1913) are archaic-heavy, so accepting them
// would undo the archaic rule the rest of this file exists to enforce; and
// Wordnik's Wiktionary tier carries a long tail including slurs, with no
// `offensive` flag to catch them the way MW's `meta.offensive` does. A
// definition from any other source is ignored rather than read as evidence
// either way -- `sourceDictionaries=all` is requested and the filtering happens
// here, because Wordnik's own multi-value filter falls back to the *first*
// dictionary with a hit rather than pooling them.
const WORDNIK_TRUSTED_SOURCE_RE = /^(ahd(-|$)|wordnet$)/;
// Wiktionary can't approve a word here, but it is the only Wordnik source with
// systematic per-sense register tags, so it is allowed to *veto* one. Measured
// against the live API: AHD marks a register only sporadically -- "anon" carries
// {"text":"Archaic","type":"fld"} on one sense, while "gramercy", "yclept",
// "sooth" and "bedight" come back with no label at all -- so approving on AHD's
// silence alone would let archaic words through that MW rejects today. Wiktionary
// labels all three of gramercy's senses {"text":"archaic","type":"chronological"}.
const WORDNIK_VETO_SOURCE = "wiktionary";
// Register marks, by the same severity ranking the MW path and the offline
// pipeline use. Matched against label text whatever the label's `type`, since
// AHD files them under "fld" and Wiktionary under "chronological".
const WORDNIK_STATUS_SEVERITY: Array<[RegExp, number]> = [
  [/\bobsolete\b/i, 3],
  [/\barchaic\b/i, 2],
  [/\bdated\b/i, 1],
];
const SEVERITY_REASON: Record<number, RejectReason> = {
  3: "obsolete",
  2: "archaic",
  1: "dated",
};
// Wordnik parts of speech that mean the entry is not an ordinary word. Proper
// nouns are matched by prefix, since the plural and possessive variants are
// spelled as suffixes of it.
const WORDNIK_ABBR_POS = new Set(["abbreviation", "initialism", "acronym"]);
const WORDNIK_NAME_POS_PREFIX = "proper-noun";

// The game's own input rule: English letters only, no upper length cap beyond
// the input's own, so long real words ("gastroenterologist") stay eligible.
const WORD_RE = /^[a-z]{2,30}$/;
const USER_AGENT = "WordInk live word check (wordink.app)";
// Upstream calls are bounded so the function can't hang; the client stops waiting
// after LIVE_HANDOFF_MS, but a wedged request would still hold quota.
const UPSTREAM_TIMEOUT_MS = 5000;

type Outcome = "playable" | "rejected" | "unknown" | "error";

/** Why a word MW knows about still isn't playable. Mirrors the game's reasons. */
type RejectReason =
  | "proper-noun"
  | "abbreviation"
  | "name-or-abbreviation"
  | "archaic"
  | "obsolete"
  | "dated"
  | "offensive";

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
  /**
   * Which reference answered: an MW one ("collegiate", "medical",
   * "collegiate+medical"), a Wordnik one ("wordnik:ahd-5", "wordnik:wordnet",
   * or both joined with "+"), or null when nothing attested the word.
   */
  source?: string | null;
  /**
   * A lookup problem that did not stop an answer being produced -- one reference
   * failed while the other still replied. The verdict stands, but the caller
   * should report this so a half-broken lookup is visible.
   */
  failure?: { reason: string; detail: string; status: number | null } | null;
}

// Only the fields we read from an MW entry. The sense tree under `def` is deeply
// and loosely structured, so it stays `unknown` and is walked with runtime guards.
interface MwEntry {
  meta?: { id?: string; offensive?: boolean };
  fl?: string;
  date?: string;
  def?: unknown[];
}

/**
 * Only the fields we read from a Wordnik definition. Each label in `labels` is an
 * object with a `text` and a `type`; only the text is read.
 */
interface WordnikDefinition {
  word?: string;
  text?: string;
  partOfSpeech?: string;
  sourceDictionary?: string;
  labels?: unknown[];
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
 * only by the body text, so the body decides between them. Wordnik reports its
 * per-minute and hourly caps as a 429, which land in the same "quota-exceeded"
 * bucket -- and
 * because a Wordnik failure only ever arrives as a `failure` alongside an
 * `unknown` verdict, never as a top-level error, it is reported without
 * switching live checks off for the session the way a spent MW quota does.
 */
function classifyUpstreamFailure(status: number, body: string): UpstreamError {
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
    throw classifyUpstreamFailure(response.status, body);
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
 * Wordnik's definitions for `word`, or an empty list when it has none. A word
 * Wordnik doesn't know answers 404, which is a miss rather than a failure, so it
 * is the one status not reported as an upstream problem.
 *
 * `useCanonical=false` keeps Wordnik from silently answering about a different
 * headword, and the returned `word` is checked anyway in classifyWordnik.
 */
async function fetchWordnik(word: string, key: string): Promise<WordnikDefinition[]> {
  const url =
    `https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}/definitions` +
    `?limit=50&includeRelated=false&useCanonical=false&includeTags=false` +
    `&sourceDictionaries=all&api_key=${encodeURIComponent(key)}`;
  try {
    const data = await fetchJson(url, "wordnik");
    return Array.isArray(data) ? (data as WordnikDefinition[]) : [];
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) return [];
    throw error;
  }
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

/** Out-of-use severity of a Wordnik definition's labels (0 = current). */
function wordnikSeverity(def: WordnikDefinition): number {
  let max = 0;
  for (const raw of def.labels ?? []) {
    const text = String((raw as { text?: unknown } | null)?.text ?? "");
    for (const [pattern, severity] of WORDNIK_STATUS_SEVERITY) {
      if (severity > max && pattern.test(text)) max = severity;
    }
  }
  return max;
}

/**
 * Reject a word every one of whose ordinary senses is out of use, reporting the
 * mildest register among them -- the rule the MW path and the offline Wiktionary
 * import both apply. Null when the senses don't all agree, or when there are none.
 */
function outOfUseReason(severities: number[]): RejectReason | null {
  if (severities.length === 0 || !severities.every((severity) => severity > 0)) return null;
  return SEVERITY_REASON[Math.min(...severities)];
}

/**
 * Decide whether Wordnik's definitions make this word playable, applying the
 * same rules as `classify` with the evidence Wordnik actually provides.
 *
 * Approval needs a trusted source dictionary (see WORDNIK_TRUSTED_SOURCE_RE);
 * a word attested only by Century, GCIDE/Webster or Wiktionary comes back
 * "unknown" and the original rejection stands. Rejection is looser on purpose:
 * Wiktionary's register tags can veto a word AHD lists without a label, because
 * AHD supplies one only sometimes and approving on its silence would admit
 * archaic words MW rejects today.
 *
 * There is no offensive flag to read anywhere here, which is the other reason
 * approval is limited to AHD and WordNet: they have no slur tail for one to be
 * needed on.
 *
 * Returns the verdict plus the source dictionaries that produced it, for the
 * `source` field.
 */
function classifyWordnik(
  word: string,
  defs: WordnikDefinition[]
): { verdict: Classification; sources: string[] } {
  const pos = new Set<string>();
  const sources = new Set<string>();
  const trustedSeverities: number[] = [];
  const vetoSeverities: number[] = [];
  let hasOrdinary = false;
  let hasName = false;
  let hasAbbr = false;

  for (const def of defs) {
    // Wordnik answers about related headwords too, and returns stub entries with
    // no definition text; neither is evidence about the queried word.
    if (String(def.word ?? "").trim().toLowerCase() !== word) continue;
    if (!String(def.text ?? "").trim()) continue;
    const sourceDictionary = String(def.sourceDictionary ?? "").toLowerCase();
    const trusted = WORDNIK_TRUSTED_SOURCE_RE.test(sourceDictionary);
    if (!trusted && sourceDictionary !== WORDNIK_VETO_SOURCE) continue;

    const partOfSpeech = String(def.partOfSpeech ?? "").toLowerCase();
    // A name or abbreviation sense is not an ordinary sense, so it neither
    // approves the word nor counts toward the out-of-use rule.
    if (WORDNIK_ABBR_POS.has(partOfSpeech)) {
      if (trusted) hasAbbr = true;
      continue;
    }
    if (partOfSpeech.startsWith(WORDNIK_NAME_POS_PREFIX)) {
      if (trusted) hasName = true;
      continue;
    }

    if (trusted) {
      sources.add(sourceDictionary);
      if (partOfSpeech) pos.add(partOfSpeech);
      hasOrdinary = true;
      trustedSeverities.push(wordnikSeverity(def));
    } else {
      vetoSeverities.push(wordnikSeverity(def));
    }
  }

  const posList = [...pos].sort();
  const sourceList = [...sources].sort();
  const verdict = (outcome: Classification["outcome"], reason: RejectReason | null) => ({
    verdict: { outcome, reason, pos: posList, firstUse: null },
    sources: sourceList,
  });

  if (hasOrdinary) {
    // The trusted sources' own verdict first, then Wiktionary's veto.
    const reason = outOfUseReason(trustedSeverities) ?? outOfUseReason(vetoSeverities);
    if (reason) return verdict("rejected", reason);
    return verdict("playable", null);
  }
  if (hasName && hasAbbr) return verdict("rejected", "name-or-abbreviation");
  if (hasName) return verdict("rejected", "proper-noun");
  if (hasAbbr) return verdict("rejected", "abbreviation");
  return verdict("unknown", null);
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

  // Both references are queried at the same time, and their matching entries are
  // pooled before classifying. That means a word either one lists as current is
  // playable: Collegiate calling a sense archaic cannot veto Medical listing it
  // as a live clinical term, because the per-sense rule only rejects when *every*
  // ordinary sense found anywhere is out of use. Running them concurrently also
  // costs one round-trip rather than two.
  const settled = await Promise.allSettled(
    configured.map(([reference, key]) =>
      fetchMw(reference, word, key).then((data) => ({ reference, data }))
    )
  );

  const entries: MwEntry[] = [];
  const sources: string[] = [];
  let failure: UpstreamError | undefined;
  for (const result of settled) {
    if (result.status === "rejected") {
      // Keep the first upstream problem so it can be reported even if the other
      // reference still answers -- a silently half-broken lookup is the thing
      // most likely to go unnoticed.
      if (result.reason instanceof UpstreamError) failure ??= result.reason;
      else throw result.reason;
      continue;
    }
    const matches = result.value.data.filter((raw) => {
      // A miss comes back as an array of spelling-suggestion strings.
      if (!raw || typeof raw !== "object") return false;
      const stem = String((raw as MwEntry).meta?.id ?? "").split(":")[0];
      return stem.toLowerCase() === word;
    }) as MwEntry[];
    if (matches.length > 0) {
      entries.push(...matches);
      sources.push(result.value.reference);
    }
  }

  // No evidence at all *and* something broke: "unknown" would be an assertion we
  // can't support, since the failed reference may well have had the word.
  if (entries.length === 0 && failure) {
    return json(errorBody(word, failure), 502, false);
  }

  let source = sources.join("+") || null;
  let classification = classify(entries);

  // Second tier. MW has no matching entry, so the rejection is about to stand on
  // MW's silence alone -- ask Wordnik before it does. This runs on an MW miss
  // only, so the common case never touches it, and MW keeps the last word
  // wherever it had one (including its offensive flag, which Wordnik has no
  // equivalent of).
  //
  // A Wordnik failure here is recorded like a half-broken MW lookup: the verdict
  // is genuinely incomplete, so it is reported and left uncached rather than
  // turned into a top-level error.
  const wordnikKey = process.env.WORDNIK_KEY;
  if (classification.outcome === "unknown" && wordnikKey) {
    try {
      const { verdict, sources: wordnikSources } = classifyWordnik(
        word,
        await fetchWordnik(word, wordnikKey)
      );
      if (verdict.outcome !== "unknown") {
        classification = verdict;
        source = `wordnik:${wordnikSources.join("+")}`;
      }
    } catch (error) {
      if (error instanceof UpstreamError) failure ??= error;
      else throw error;
    }
  }

  // If a reference approved the word, that is a success, full stop -- a problem
  // reaching the *other* reference changed nothing about the answer, so it is not
  // reported as a failure. A partial failure only matters when the word was not
  // approved: there, the reference we couldn't reach might have been the one that
  // would have approved it, so the verdict is genuinely incomplete and the client
  // reports it. Such a response is also left uncached, since a fuller answer may
  // be available on the next try.
  const partial =
    failure && classification.outcome !== "playable"
      ? { reason: failure.reason, detail: failure.detail, status: failure.status ?? null }
      : null;

  if (classification.outcome !== "playable") {
    return json(
      {
        word,
        outcome: classification.outcome,
        reason: classification.reason,
        zipf: null,
        pos: classification.pos,
        firstUse: classification.firstUse,
        source,
        failure: partial,
      },
      200,
      partial === null
    );
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

  return json(
    {
      word,
      outcome: "playable",
      reason: null,
      zipf,
      pos: classification.pos,
      firstUse: classification.firstUse,
      source,
      failure: partial,
    },
    200,
    partial === null
  );
}
