// The complete dictionary: standard mode playing off the corpus, with the tags
// applied as rejections at the point of play rather than as an absence from the
// word list. See COMPLETE_DICTIONARY_START.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateSubmission } from "./submit";
import {
  CORPUS_SOURCES,
  CORPUS_TAGS,
  loadCorpus,
  resetCorpusForTests,
  sourceBit,
  tagBit,
} from "./corpus";
import {
  COMPLETE_DICTIONARY_START,
  FREEFORM_START,
  isUnattestedZipf,
} from "./dictionary";

const DATE = COMPLETE_DICTIONARY_START;
const BEFORE = "2026-09-01"; // before either cutover
const DROP = "ric";

// Sorted, as the corpus always is. None are in the curated dictionary: the
// corpus branch is only reached for words the list has never heard of.
const WORDS = [
  "abrupts", // described, counted by nobody, folds onto "abrupt" (Zipf 3.38)
  "alaphosphin", // described, counted by nobody, folds onto nothing
  "ricardian", // a proper noun
  "riched", // archaic and unmeasured -- below the gate
  "richement", // archaic, but measured in live use -- above the gate
  "ricieve", // a misspelling
  "ricxyz", // counted by a frequency corpus, described by nobody
];
const TAGS: Record<string, number> = {
  abrupts: 0,
  alaphosphin: 0,
  ricardian: tagBit("proper-noun"),
  richement: tagBit("archaic"),
  riched: tagBit("archaic"),
  ricieve: tagBit("misspelling"),
  ricxyz: 0,
};
const LEXICON = sourceBit("wiktionary") | sourceBit("macos_dict");
const SOURCES: Record<string, number> = {
  abrupts: LEXICON,
  alaphosphin: LEXICON,
  ricardian: LEXICON,
  richement: LEXICON,
  riched: LEXICON,
  ricieve: LEXICON,
  ricxyz: sourceBit("norvig"),
};
// Bytes, at the corpus's scale of 32 to the Zipf. 0 means "no corpus attests it".
const ZIPF: Record<string, number> = {
  abrupts: 0,
  alaphosphin: 0,
  ricardian: 0,
  richement: 96, // 3.00, clear of the out-of-use gate at 2.5
  riched: 0,
  ricieve: 0,
  ricxyz: 40,
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
                const map = url.includes("tags.bin")
                  ? TAGS
                  : url.includes("sources.bin")
                    ? SOURCES
                    : ZIPF;
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

describe("words the curated list has never heard of", () => {
  it("accepts a described word and leaves it at the unattested sentinel", () => {
    const result = evaluateSubmission("alaphosphin", "pho", [], DATE);
    expect(result.ok).toBe(true);
    // The same value rarity.json already holds for a curated word no corpus
    // attests: a missing Zipf is a gap in the corpora, and the wider dictionary
    // does not invent a frequency to fill it.
    expect(isUnattestedZipf(result.word!.zipf)).toBe(true);
    expect(result.word!.rarity).toBe("Legend");
  });

  it("folds an unmeasured word onto a measured base where it has one", () => {
    const result = evaluateSubmission("abrupts", "rup", [], DATE);
    expect(result.ok).toBe(true);
    // "abrupt" is Zipf 3.38, so the fold prices the word on a real measurement
    // rather than on the sentinel a word with no reachable base keeps.
    expect(result.word!.zipf).toBeCloseTo(3.38);
    expect(isUnattestedZipf(result.word!.zipf)).toBe(false);
  });
});

describe("the rules applied after the fact", () => {
  it("refuses a proper noun, a misspelling and an out-of-use word by name", () => {
    expect(evaluateSubmission("ricardian", DROP, [], DATE).reason).toBe("proper-noun");
    expect(evaluateSubmission("ricieve", DROP, [], DATE).reason).toBe("misspelling");
    expect(evaluateSubmission("riched", DROP, [], DATE).reason).toBe("archaic");
  });

  it("ignores an out-of-use tag on a word corpora still measure in live use", () => {
    // The gate the curated list's own derived rejections use: below Zipf 2.5 the
    // tag holds up, above it the tag is one dead sense of an ordinary word.
    const result = evaluateSubmission("richement", DROP, [], DATE);
    expect(result.ok).toBe(true);
    expect(result.word!.zipf).toBeCloseTo(3);
  });

  it("still refuses a string only a frequency corpus ever counted", () => {
    // Not a register objection and not the corpus's to waive: counted, never
    // described. It falls through to the live lookup as it always did.
    expect(evaluateSubmission("ricxyz", DROP, [], DATE).ok).toBe(false);
  });

  it("lets a reviewed rejection outrank the corpus", () => {
    // "abideth" is on the curated list and rejected there as archaic. The corpus
    // is not consulted for it at all, whatever it happens to say.
    expect(evaluateSubmission("abideth", "ide", [], DATE).reason).toBe("archaic");
  });
});

describe("standard mode only", () => {
  it("leaves freeform week's own rules in force where the two overlap", () => {
    // The opposite rule on the same word: the week waives the register
    // objections and prices a word on its own frequency, so an unmeasured
    // archaic word is a Legend there and a refusal here. If the trial is ever
    // extended over the cutover, the week still wins.
    const result = evaluateSubmission("riched", DROP, [], FREEFORM_START);
    expect(result.ok).toBe(true);
    expect(isUnattestedZipf(result.word!.zipf)).toBe(true);
    expect(result.word!.rarity).toBe("Legend");
  });
});

describe("before the cutover", () => {
  it("does not consult the corpus at all", () => {
    for (const word of ["alaphosphin", "abrupts"]) {
      expect(evaluateSubmission(word, word.slice(1, 4), [], BEFORE).ok).toBe(false);
    }
  });

  it("leaves an archived puzzle's verdicts exactly as they were", () => {
    expect(evaluateSubmission("richement", DROP, [], BEFORE).ok).toBe(false);
  });
});

describe("the corpus never blocks play", () => {
  it("answers nothing before it loads, rather than refusing early", () => {
    resetCorpusForTests();
    // The same rejection as before the corpus existed, which is what hands the
    // word to the live lookup.
    expect(evaluateSubmission("alaphosphin", "pho", [], DATE).ok).toBe(false);
  });

  it("leaves the ordinary gates in force", () => {
    expect(evaluateSubmission("alaphosphin", "zzz", [], DATE).ok).toBe(false);
    const used = [{ word: "alaphosphin", rarity: "Legend" as const, zipf: -1.57 }];
    expect(evaluateSubmission("alaphosphin", "pho", used, DATE).ok).toBe(false);
  });
});
