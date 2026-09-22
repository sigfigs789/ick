// Playing off the corpus: which words it lets in, which it still refuses, and
// what they score. Three eras -- before the trial the corpus is not consulted at
// all, the trial week consults it waiving six reasons, and from MODE_CHOICE_START
// both modes consult it waiving three and treating the rest as verdicts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateSubmission } from "./submit";
import { CORPUS_SOURCES, CORPUS_TAGS, loadCorpus, resetCorpusForTests, sourceBit, tagBit } from "./corpus";
import { FREEFORM_START, isUnattestedZipf } from "./dictionary";
import { MODE_CHOICE_START } from "./mode";

const FREEFORM_DATE = FREEFORM_START;
const ORDINARY_DATE = "2026-09-01"; // before the window
const CHOICE_DATE = MODE_CHOICE_START; // both modes, one set of tags
const DROP = "ser";

// Sorted, as the corpus always is.
// None of these are in the curated dictionary -- the corpus branch is only
// reached for words it has never heard of.
const WORDS = [
  "prosery",
  "sermonicky",
  "sermonics",
  "serpentivorous",
  "sersed",
  "sersion",
  "serxyz",
];
const TAGS: Record<string, number> = {
  prosery: tagBit("proper-noun"),
  sermonicky: tagBit("obsolete"),
  sermonics: 0,
  serpentivorous: 0,
  sersed: 0,
  sersion: tagBit("misspelling"),
  serxyz: 0,
};
const SOURCES: Record<string, number> = {
  prosery: sourceBit("wiktionary"),
  sermonicky: sourceBit("wiktionary"),
  sermonics: sourceBit("wiktionary") | sourceBit("norvig"),
  serpentivorous: sourceBit("wiktionary") | sourceBit("macos_dict"),
  sersed: sourceBit("wiktionary"),
  sersion: sourceBit("wiktionary"),
  serxyz: sourceBit("norvig"), // counted by a frequency corpus, described by nobody
};
const ZIPF: Record<string, number> = {
  prosery: 0,
  sermonicky: 16, // 0.5 -- below the out-of-use ceiling, so the tag is trusted
  sermonics: 48, // 48 / 32 = 1.5
  serpentivorous: 0, // unattested
  sersed: 0,
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
    expect(result.word!.zipf).toBeCloseTo(1.5);
    expect(isUnattestedZipf(result.word!.zipf)).toBe(false);
  });

  it("accepts an unattested lexicon word at the flat Legend sentinel", () => {
    const result = evaluateSubmission("serpentivorous", DROP, [], FREEFORM_DATE);
    expect(result.ok).toBe(true);
    // The decision this rests on: no corpus counts the word, and freeform week
    // prices it as a Legend rather than refusing it.
    expect(isUnattestedZipf(result.word!.zipf)).toBe(true);
    expect(result.word!.rarity).toBe("Legend");
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

describe("before the trial", () => {
  it("does not consult the corpus at all", () => {
    for (const word of ["sermonics", "serpentivorous"]) {
      expect(evaluateSubmission(word, DROP, [], ORDINARY_DATE).ok).toBe(false);
    }
  });
});

describe("from the mode switch, both modes off one corpus", () => {
  it("accepts a lexicon word the curated list never held", () => {
    const result = evaluateSubmission("sermonics", DROP, [], CHOICE_DATE);
    expect(result.ok).toBe(true);
    // Not its own 1.5: an ordinary puzzle folds, and "sermonics" is a plural of
    // the curated "sermonic". The trial week is the one that reads the 1.5.
    expect(result.word!.zipf).toBeGreaterThan(1.5);
  });

  it("still accepts a proper noun, which both modes waive", () => {
    expect(evaluateSubmission("prosery", DROP, [], CHOICE_DATE).ok).toBe(true);
  });

  it("refuses an out-of-use word and says which register", () => {
    // The trio goes back in force at the switch: the same word plays during the
    // trial week and does not play here.
    expect(evaluateSubmission("sermonicky", DROP, [], FREEFORM_DATE).ok).toBe(true);
    const result = evaluateSubmission("sermonicky", DROP, [], CHOICE_DATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("obsolete");
  });

  it("names the misspelling rather than leaving it to the live lookup", () => {
    const result = evaluateSubmission("sersion", DROP, [], CHOICE_DATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("misspelling");
  });

  it("still refuses a string only a frequency corpus ever counted", () => {
    expect(evaluateSubmission("serxyz", DROP, [], CHOICE_DATE).ok).toBe(false);
  });

  it("folds an unattested derivation onto its curated base", () => {
    // "sersed" is unattested, so on its own frequency it would be a flat 10.00
    // Legend. The fold reads it as a tense form of the curated "serse" and caps
    // it there -- the whole reason a corpus word is not scored off its raw Zipf.
    const result = evaluateSubmission("sersed", DROP, [], CHOICE_DATE);
    expect(result.ok).toBe(true);
    expect(isUnattestedZipf(result.word!.zipf)).toBe(false);
  });

  it("leaves the trial week scoring each word on its own frequency", () => {
    const trial = evaluateSubmission("sersed", DROP, [], FREEFORM_DATE);
    expect(trial.ok).toBe(true);
    expect(isUnattestedZipf(trial.word!.zipf)).toBe(true);
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
