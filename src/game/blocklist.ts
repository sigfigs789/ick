// The hand-reviewed blocklist, as the game sees it.
//
// scripts/blocklist.txt has always been the list, and until the corpus arrived
// it was enough to apply it once at build time: generate-data.py dropped these
// words on the way into dictionary.json, so nothing downstream had to know they
// existed. The corpus is not built that way. It keeps every headword it can find
// and records only what is *true* about a word, never whether the game wants it
// -- so the blocklist is a judgement the corpus deliberately does not carry, and
// the filter has to live here instead.
//
// That matters more than it sounds: 34 of the 36 entries are attested lexicon
// words with clean tags, so a corpus lookup would hand back a perfectly ordinary
// verdict for every slur on the list. See corpusVerdict in submit.ts, the one
// caller.
//
// src/data/blocklist.json is generated from scripts/blocklist.txt by
// build-word-corpus.py; blocklist.test.ts holds the two in lockstep so an entry
// added to the text file can never be silently missing here.
import blocklistData from "../data/blocklist.json";

const BLOCKED: ReadonlySet<string> = new Set(blocklistData as string[]);

/** Whether `word` is blocked outright, whatever any lexicon says about it. */
export function isBlocked(word: string): boolean {
  return BLOCKED.has(word);
}

/** How many words the blocklist holds. Tests and diagnostics only. */
export function blocklistSize(): number {
  return BLOCKED.size;
}
