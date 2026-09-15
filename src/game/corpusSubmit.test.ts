// Freeform week playing off the corpus: which words it lets in, which it still
// refuses, and what they score.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateSubmission } from "./submit";
import { CORPUS_SOURCES, CORPUS_TAGS, loadCorpus, resetCorpusForTests, sourceBit, tagBit } from "./corpus";
import { FREEFORM_START, isUnattestedZipf } from "./dictionary";

const FREEFORM_DATE = FREEFORM_START;
const ORDINARY_DATE = "2026-09-01"; // before the window
const DROP = "ser";

// Sorted, as the corpus always is.
// None of these are in the curated dictionary -- the corpus branch is only
// reached for words it has never heard of.
const WORDS = ["sermonics", "serpentivorous", "sersion", "serxyz"];
const TAGS: Record<string, number> = {
  sermonics: 0,
  serpentivorous: 0,
  sersion: tagBit("misspelling"),
  serxyz: 0,
};
const SOURCES: Record<string, number> = {
  sermonics: sourceBit("wiktionary") | sourceBit("norvig"),
  serpentivorous: sourceBit("wiktionary") | sourceBit("macos_dict"),
  sersion: sourceBit("wiktionary"),
  serxyz: sourceBit("norvig"), // counted by a frequency corpus, described by nobody
};
const ZIPF: Record<string, number> = {
  sermonics: 48, // 48 / 32 = 1.5
  serpentivorous: 0, // unattested
  sersion: 64,
  serxyz: 40,
};

function frontCode(words: string[]): string {
  let previous = "";
  return (
    words
      .map((word) => {
        let shared = 0;
        while (shared < previous.length && shared < word.length && previous[shared] === word[shared])
          shared++;
        previous = word;
        return String.fromCharCode(48 + Math.min(shared, 35)) + word.slice(Math.min(shared, 35));
      })
      .join("\n") + "\n"
  );
}

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.includes("meta.json")
        ? {
            json: () =>
              Promise.resolve({
                count: WORDS.length,
                tagOrder: [...CORPUS_TAGS],
                sourceOrder: [...CORPUS_SOURCES],
                zipfScale: 32,
              }),
          }
        : url.includes("words.txt")
          ? { text: () => Promise.resolve(frontCode(WORDS)) }
          : {
              arrayBuffer: () => {
                const map = url.includes("tags.bin") ? TAGS : url.includes("sources.bin") ? SOURCES : ZIPF;
                return Promise.resolve(new Uint8Array(WORDS.map((w) => map[w])).buffer);
              },
            };
      return Promise.resolve({ ok: true, ...body } as unknown as Response);
    })
  );
  await loadCorpus();
});

afterEach(() => {
  resetCorpusForTests();
  vi.unstubAllGlobals();
});

describe("freeform week, words the curated list has never heard of", () => {
  it("accepts a word a lexicon describes and scores it on its own frequency", () => {
    const result = evaluateSubmission("sermonics", DROP, [], FREEFORM_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.word.zipf).toBeCloseTo(1.5);
    expect(isUnattestedZipf(result.word.zipf)).toBe(false);
  });

  it("accepts an unattested lexicon word at the flat Legend sentinel", () => {
    const result = evaluateSubmission("serpentivorous", DROP, [], FREEFORM_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The decision this rests on: no corpus counts the word, and freeform week
    // prices it as a Legend rather than refusing it.
    expect(isUnattestedZipf(result.word.zipf)).toBe(true);
    expect(result.word.rarity).toBe("Legend");
  });

  it("still refuses a misspelling, which the week never waived", () => {
    const result = evaluateSubmission("sersion", DROP, [], FREEFORM_DATE);
    expect(result.ok).toBe(false);
  });

  it("still refuses a string only a frequency corpus ever counted", () => {
    // "serxyz" has a Zipf and no tags, so nothing but its sources disqualifies
    // it -- this is the case sources.bin exists for.
    const result = evaluateSubmission("serxyz", DROP, [], FREEFORM_DATE);
    expect(result.ok).toBe(false);
  });

  it("refuses a word the corpus has never heard of either", () => {
    expect(evaluateSubmission("serqqq", DROP, [], FREEFORM_DATE).ok).toBe(false);
  });
});

describe("outside freeform week", () => {
  it("does not consult the corpus at all", () => {
    for (const word of ["sermonics", "serpentivorous"]) {
      expect(evaluateSubmission(word, DROP, [], ORDINARY_DATE).ok).toBe(false);
    }
  });
});

describe("the corpus never makes a word less playable", () => {
  it("leaves the ordinary gates in force during freeform week", () => {
    // Missing the drop, and already used, are not the corpus's to overrule.
    expect(evaluateSubmission("sermonics", "zzz", [], FREEFORM_DATE).ok).toBe(false);
    const used = [{ word: "sermonics", rarity: "Legend" as const, zipf: 1.5 }];
    expect(evaluateSubmission("sermonics", DROP, used, FREEFORM_DATE).ok).toBe(false);
  });

  it("answers nothing before the corpus loads, rather than refusing early", () => {
    resetCorpusForTests();
    const result = evaluateSubmission("sermonics", DROP, [], FREEFORM_DATE);
    // Falls through to the same rejection as before the corpus existed, which
    // is what hands the word to the live lookup.
    expect(result.ok).toBe(false);
  });
});
