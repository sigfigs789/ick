// The expansive word corpus: every English headword we could find, tagged with
// what we know about it rather than filtered down to what one mode allows.
//
// src/data/dictionary.json stays the curated list and keeps its static import.
// This sits beside it, fetched at runtime, and answers a different question:
// not "is this word playable" but "what do we know about this word". Each mode
// decides what to do with the answer -- see corpusVerdict() in submit.ts.
//
// Three reasons it is fetched rather than imported:
//   1. 3.6MB gzipped has no business in the initial bundle of a word game.
//   2. rarity.json is a positional array index-aligned with dictionary.json, so
//      the curated list cannot absorb these words without repricing every
//      archived puzzle. The corpus carries its own scores instead.
//   3. A mode that never consults it should never pay for it.
//
// Nothing here blocks play. Until the fetch resolves every lookup answers
// "unknown" and the caller falls through to the live lookup exactly as before.

import { APP_VERSION } from "../version";
import type { RejectionReason } from "./types";

/** Where build-word-corpus.py writes, served straight out of public/. */
const CORPUS_BASE = "/corpus";

/**
 * Bit positions in tags.bin, and the shape meta.json is checked against.
 *
 * Every tag is a lexical property of the word. Where a word came from is not
 * one of those and lives in sources.bin -- "no lexicon describes this" and
 * "this is an abbreviation" are different claims and a filter wants them apart.
 */
export const CORPUS_TAGS = [
  "proper-noun",
  "capitalized-only",
  "obsolete",
  "archaic",
  "dated",
  "abbreviation",
  "misspelling",
] as const;
export type CorpusTag = (typeof CORPUS_TAGS)[number];

/** Bit positions in sources.bin. */
export const CORPUS_SOURCES = [
  "wiktionary",
  "dictionary",
  "macos_dict",
  "wordfreq",
  "norvig",
  "google_books",
  "datamuse",
  "curated",
] as const;
export type CorpusSource = (typeof CORPUS_SOURCES)[number];

export type CorpusEntry = {
  /** Lexical properties, as a bitmask over CORPUS_TAGS. */
  tags: number;
  /** Which corpora attest the word, as a bitmask over CORPUS_SOURCES. */
  sources: number;
  /** Waterfall Zipf, or null when no corpus attests the word at all. */
  zipf: number | null;
};

export function tagBit(tag: CorpusTag): number {
  return 1 << CORPUS_TAGS.indexOf(tag);
}

export function sourceBit(source: CorpusSource): number {
  return 1 << CORPUS_SOURCES.indexOf(source);
}

/** The tags a mask carries, for diagnostics and tests rather than hot paths. */
export function tagsOf(mask: number): CorpusTag[] {
  return CORPUS_TAGS.filter((_, bit) => (mask >> bit) & 1);
}

export function sourcesOf(mask: number): CorpusSource[] {
  return CORPUS_SOURCES.filter((_, bit) => (mask >> bit) & 1);
}

/**
 * The rejection a tag amounts to, so the corpus can be judged by the same
 * waivers the curated list is (see waivesRejectionReason in dictionary.ts).
 *
 * A tag is an observation and a RejectionReason is a verdict, which is why this
 * mapping lives here rather than in the tag list itself: the corpus builder has
 * no opinion about playability and the two vocabularies only meet at this line.
 *
 * "capitalized-only" maps onto "proper-noun" because it is the same claim
 * arrived at by a different route -- Wiktionary filed the headword under a name
 * part of speech, or nobody ever wrote it lower-case -- and a player who tries
 * "kaohsiung" is owed the same answer either way.
 */
export const CORPUS_TAG_REASONS: Readonly<Record<CorpusTag, RejectionReason>> = {
  "proper-noun": "proper-noun",
  "capitalized-only": "proper-noun",
  obsolete: "obsolete",
  archaic: "archaic",
  dated: "dated",
  abbreviation: "abbreviation",
  misspelling: "misspelling",
};

/**
 * The reasons a tag mask carries, strongest first, so a caller that has to name
 * one names the most specific. The order is REASON_PRIORITY from
 * scripts/generate-data.py read downward, and the two files are the same
 * judgement: a misspelling is the most definite fault a word can have, a name
 * or abbreviation outranks a register, and within the registers "obsolete"
 * (dead) outranks "archaic" outranks "dated" (merely old-fashioned) so the
 * message never overstates how dead the word is.
 */
const REASON_STRENGTH: readonly CorpusTag[] = [
  "misspelling",
  "abbreviation",
  "proper-noun",
  "capitalized-only",
  "obsolete",
  "archaic",
  "dated",
];

/** Every reason a tag mask carries, strongest first. */
export function reasonsOf(mask: number): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  for (const tag of REASON_STRENGTH) {
    if (!(mask & tagBit(tag))) continue;
    const reason = CORPUS_TAG_REASONS[tag];
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

/*
 * The loaded corpus.
 *
 * Words are held as one newline-joined string with an Int32Array of line
 * starts, not as an array or a Map. At 1.2M entries the difference is not a
 * micro-optimisation: a Map<string, number> costs somewhere north of 70MB on a
 * phone, while a single string plus 4 bytes per word is roughly 18MB, and the
 * string is one allocation the engine already knows how to keep flat.
 *
 * Lookup is a binary search comparing slices. That costs ~21 comparisons per
 * word, which is nothing against a single frame, and keeps the resident cost
 * proportional to the text rather than to the object header of every entry.
 */
type Loaded = {
  words: string;
  offsets: Int32Array;
  tags: Uint8Array;
  sources: Uint8Array;
  zipf: Uint8Array;
  zipfScale: number;
};

let loaded: Loaded | undefined;
let inFlight: Promise<boolean> | undefined;

/** Whether a corpus lookup can answer anything yet. */
export function corpusReady(): boolean {
  return loaded !== undefined;
}

/** How many words the loaded corpus holds; 0 before it arrives. */
export function corpusSize(): number {
  return loaded ? loaded.offsets.length : 0;
}

/**
 * Expand the front-coded word list.
 *
 * Each line is a shared-prefix length as a single character (chr(48 + n),
 * capped at 35 so it stays printable) followed by the rest of the word. The
 * encoding exists because a sorted English word list repeats its own prefixes
 * relentlessly -- it takes 12.5MB down to 5.4MB before gzip, and gzip is not
 * enough on its own because the client still has to hold the result.
 */
function expand(source: string): { words: string; offsets: Int32Array } {
  const lines = source.split("\n");
  // A trailing newline leaves an empty final entry; drop it rather than letting
  // an empty string into the middle of a sorted array, where it would break the
  // binary search's ordering assumption.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const offsets = new Int32Array(lines.length);
  const out: string[] = new Array(lines.length);
  let previous = "";
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const shared = line.charCodeAt(0) - 48;
    const word = previous.slice(0, shared) + line.slice(1);
    out[i] = word;
    offsets[i] = cursor;
    cursor += word.length + 1; // +1 for the newline join below
    previous = word;
  }
  return { words: out.join("\n"), offsets };
}

/** The word at `index`, sliced out of the flat string. */
function wordAt(data: Loaded, index: number): string {
  const start = data.offsets[index];
  const end = index + 1 < data.offsets.length ? data.offsets[index + 1] - 1 : data.words.length;
  return data.words.slice(start, end);
}

/** Index of `word`, or -1. The list is sorted, which is what makes this legal. */
function indexOf(data: Loaded, word: string): number {
  let low = 0;
  let high = data.offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = wordAt(data, mid);
    if (candidate === word) return mid;
    if (candidate < word) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/**
 * What the corpus knows about `word`, or undefined when it holds no entry --
 * which is also the answer before the fetch resolves. Callers cannot tell the
 * two apart on purpose: both mean "this module has nothing to say", and both
 * should fall through to whatever the caller did before the corpus existed.
 */
export function corpusEntry(word: string): CorpusEntry | undefined {
  if (!loaded) return undefined;
  const index = indexOf(loaded, word);
  if (index < 0) return undefined;
  const raw = loaded.zipf[index];
  return {
    tags: loaded.tags[index],
    sources: loaded.sources[index],
    zipf: raw === 0 ? null : raw / loaded.zipfScale,
  };
}

/**
 * Fetch and decode the corpus. Idempotent, and safe to call from several places
 * at once -- the second caller waits on the first one's request rather than
 * starting a second 3.6MB download.
 *
 * Resolves false when the corpus could not be loaded. That is not an error the
 * player should ever see: every mode has to work without it, because a player
 * on a bad connection has to be able to play.
 */
export function loadCorpus(): Promise<boolean> {
  if (loaded) return Promise.resolve(true);
  if (inFlight) return inFlight;

  // The version pins the four files to each other. They are deployed as a set
  // and a half-stale set is worse than none: tags.bin is index-aligned with
  // words.txt, so one cached file from a previous deploy would silently hand
  // every word its neighbour's tags.
  const v = `?v=${APP_VERSION}`;
  inFlight = (async () => {
    try {
      const [metaRes, wordsRes, tagsRes, sourcesRes, zipfRes] = await Promise.all([
        fetch(`${CORPUS_BASE}/meta.json${v}`),
        fetch(`${CORPUS_BASE}/words.txt${v}`),
        fetch(`${CORPUS_BASE}/tags.bin${v}`),
        fetch(`${CORPUS_BASE}/sources.bin${v}`),
        fetch(`${CORPUS_BASE}/zipf.bin${v}`),
      ]);
      if (![metaRes, wordsRes, tagsRes, sourcesRes, zipfRes].every((r) => r.ok)) return false;

      const meta = (await metaRes.json()) as {
        count: number;
        tagOrder: string[];
        sourceOrder: string[];
        zipfScale: number;
      };
      const { words, offsets } = expand(await wordsRes.text());
      const tags = new Uint8Array(await tagsRes.arrayBuffer());
      const sources = new Uint8Array(await sourcesRes.arrayBuffer());
      const zipf = new Uint8Array(await zipfRes.arrayBuffer());

      // Refuse a corpus whose pieces disagree. Every one of these would
      // otherwise fail silently and hand out wrong tags rather than no tags,
      // and wrong tags are worse than an absent corpus: they would put a
      // misspelling into play wearing a clean record.
      const aligned =
        offsets.length === meta.count &&
        tags.length === meta.count &&
        sources.length === meta.count &&
        zipf.length === meta.count;
      const shaped =
        meta.tagOrder.length === CORPUS_TAGS.length &&
        meta.tagOrder.every((tag, i) => tag === CORPUS_TAGS[i]) &&
        meta.sourceOrder.length === CORPUS_SOURCES.length &&
        meta.sourceOrder.every((source, i) => source === CORPUS_SOURCES[i]);
      if (!aligned || !shaped) return false;

      loaded = { words, offsets, tags, sources, zipf, zipfScale: meta.zipfScale };
      return true;
    } catch {
      return false;
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

/** Drop the loaded corpus. Tests only -- nothing in the app unloads it. */
export function resetCorpusForTests(): void {
  loaded = undefined;
  inFlight = undefined;
}

/**
 * The sources that amount to "a lexicon says this is a word".
 *
 * Norvig's Google Web 1T and wordfreq are frequency corpora, not dictionaries:
 * between them they attest ~160k strings no lexicon has, and the bulk of it is
 * crawl residue -- "mxps", "emci", "travelglobe". A word carrying only those
 * bits has been *counted*, never *described*, and "not-a-word" is precisely the
 * objection to it.
 *
 * Lives here rather than in submit.ts because two callers need it now and they
 * cannot share it from there: dictionary.ts is imported *by* submit.ts, so the
 * lexicon behind the corpus-era fold (see CORPUS_ONLY_START) would have to
 * reach through a cycle to ask the same question submit.ts asks.
 */
export const LEXICON_SOURCES =
  sourceBit("wiktionary") | sourceBit("dictionary") | sourceBit("macos_dict") | sourceBit("curated");

/**
 * Whether a lexicon -- not merely a frequency count -- attests `word`, *and* the
 * word carries no tag the game treats as a fault.
 *
 * Both halves are load-bearing, and the second was learned the hard way. A fold
 * base is a word the game is willing to print, so the lexicon behind the fold
 * has to be the words the game would accept rather than every string in the
 * corpus. Admitting the tagged ones put 58 words into Mythic or Legend that had
 * no business there: "airi" (a given name, tagged proper-noun) outbid "airy" as
 * the base of "airily", "porki" did the same to "porky", and "destin"
 * (obsolete) to "destined" -- each one a name or a dead spelling standing in
 * front of the real base and capping the word at its own thin frequency, or at
 * nothing. "porkinesses" went from Rare to Legend on that.
 *
 * No waiver is consulted, unlike `corpusVerdict`, and the asymmetry is the
 * point: a waiver is a decision about what a *player* may submit under a mode's
 * rules, and this is a question about what may serve as evidence for how common
 * another word is. A proper noun is not evidence about an adjective in either
 * mode. Freeform never reaches this anyway -- it does not fold.
 *
 * False before the corpus loads, like every other question this module answers,
 * so a caller falls through to whatever it did without the corpus.
 */
export function corpusAttests(word: string): boolean {
  const entry = corpusEntry(word);
  if (!entry) return false;
  if (!(entry.sources & LEXICON_SOURCES)) return false;
  if (entry.tags !== 0) return false;
  // And it has to have been *counted*, not merely listed.
  //
  // This is the narrower half of the same lesson. A fold prices a word by a
  // relative somebody actually writes, so a headword no frequency corpus counts
  // at all carries no information about how common anything is -- it cannot win
  // `mostCommonBase` on merit, and where a spelling rule commits to it before
  // the rule that would have found the real base, it caps the word at the
  // unattested sentinel and hands it a Legend. "curli" is a genuine Wiktionary
  // entry (the bacterial fibre) with no tag to disqualify it and no count
  // behind it, and it took "curlily" from Uncommon to Legend by standing where
  // "curly" belonged. Same for "flakily", "frothily", "tinniness", "uglily".
  //
  // Not a claim that an uncounted word is a lesser word -- the game refuses to
  // make that claim about a word on its own account. It is a claim about
  // evidence: a word nobody has counted is not evidence about a word somebody
  // has. Such a word is still perfectly playable, and `corpusVerdict` still
  // accepts it on its own terms and scores it through the sentinel.
  return entry.zipf !== null;
}
