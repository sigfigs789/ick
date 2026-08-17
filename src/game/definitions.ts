// Live definition lookup via Datamuse (the same free, key-less word API the
// build scripts use -- see scripts/find-online-words.py). The app ships no
// definitions of its own: the data files hold only spellings and rarity, so a
// word's meaning is fetched on demand and cached in memory for the session.

const DATAMUSE_URL = "https://api.datamuse.com/words";

// Datamuse tags each definition with a terse part-of-speech code; expand the
// common ones and drop the "unknown" marker entirely.
const POS_LABELS: Record<string, string> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  u: "",
};

export interface Definition {
  partOfSpeech: string;
  text: string;
}

// A word is looked up at most once per session; a miss caches as null so we
// don't re-hit the network for a word we know Datamuse can't define. Thrown
// errors (offline, non-2xx) are deliberately NOT cached, so a retry is allowed.
const cache = new Map<string, Definition | null>();

function parseDef(raw: string): Definition {
  // Each Datamuse definition arrives as "<pos>\t<text>".
  const tab = raw.indexOf("\t");
  if (tab === -1) return { partOfSpeech: "", text: raw.trim() };
  const pos = raw.slice(0, tab);
  return { partOfSpeech: POS_LABELS[pos] ?? "", text: raw.slice(tab + 1).trim() };
}

export async function fetchDefinition(word: string): Promise<Definition | null> {
  const key = word.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({ sp: key, md: "d", max: "1" });
  const res = await fetch(`${DATAMUSE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Datamuse responded ${res.status}`);

  const data = (await res.json()) as Array<{ defs?: string[] }>;
  const defs = data[0]?.defs;
  const result = defs && defs.length > 0 ? parseDef(defs[0]) : null;
  cache.set(key, result);
  return result;
}
