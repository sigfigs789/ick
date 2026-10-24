import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORPUS_SOURCES,
  CORPUS_TAGS,
  corpusEntry,
  corpusReady,
  corpusSize,
  loadCorpus,
  resetCorpusForTests,
  sourceBit,
  sourcesOf,
  tagBit,
  tagsOf,
} from "./corpus";

/** Front-code a sorted list the way build-word-corpus.py does. */
function frontCode(words: string[]): string {
  let previous = "";
  const lines = words.map((word) => {
    let shared = 0;
    while (shared < previous.length && shared < word.length && previous[shared] === word[shared]) {
      shared++;
    }
    shared = Math.min(shared, 35);
    previous = word;
    return String.fromCharCode(48 + shared) + word.slice(shared);
  });
  return lines.join("\n") + "\n";
}

const WORDS = ["abaci", "aback", "abacus", "zebra", "zebras", "zymurgy"];

function serve(options: {
  words?: string[];
  tags?: number[];
  sources?: number[];
  zipf?: number[];
  /** Served as zipf-attested.bin instead of the bytes derived from `zipf`. */
  attested?: number[];
  count?: number;
  tagOrder?: string[];
  sourceOrder?: string[];
  ok?: boolean;
}) {
  const words = options.words ?? WORDS;
  const bytes = (values: number[] | undefined) =>
    new Uint8Array(values ?? new Array(words.length).fill(0));
  // zipf-attested.bin, as the build writes it: a byte for each word a frequency
  // source measured, in list order, and nothing for the rest.
  const sources = bytes(options.sources);
  const zipf = bytes(options.zipf);
  const measured = sourceBit("wordfreq") | sourceBit("norvig") | sourceBit("google_books") | sourceBit("datamuse");
  const attested = options.attested
    ? new Uint8Array(options.attested)
    : new Uint8Array([...zipf].filter((_, i) => sources[i] & measured));
  const meta = {
    count: options.count ?? words.length,
    tagOrder: options.tagOrder ?? [...CORPUS_TAGS],
    sourceOrder: options.sourceOrder ?? [...CORPUS_SOURCES],
    zipfScale: 32,
    attested: attested.length,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (options.ok === false) return Promise.resolve({ ok: false } as Response);
      const body = url.includes("meta.json")
        ? { json: () => Promise.resolve(meta) }
        : url.includes("words.txt")
          ? { text: () => Promise.resolve(frontCode(words)) }
          : url.includes("tags.bin")
            ? { arrayBuffer: () => Promise.resolve(bytes(options.tags).buffer) }
            : url.includes("sources.bin")
              ? { arrayBuffer: () => Promise.resolve(bytes(options.sources).buffer) }
              : { arrayBuffer: () => Promise.resolve(attested.buffer) };
      return Promise.resolve({ ok: true, ...body } as unknown as Response);
    })
  );
}

afterEach(() => {
  resetCorpusForTests();
  vi.unstubAllGlobals();
});

describe("loading", () => {
  it("answers nothing before the fetch resolves, rather than throwing", () => {
    expect(corpusReady()).toBe(false);
    expect(corpusSize()).toBe(0);
    expect(corpusEntry("abacus")).toBeUndefined();
  });

  it("decodes the front-coded list back to the words that went in", async () => {
    serve({});
    expect(await loadCorpus()).toBe(true);
    expect(corpusSize()).toBe(WORDS.length);
    for (const word of WORDS) expect(corpusEntry(word)).toBeDefined();
  });

  it("finds every word by binary search, and no word that isn't there", async () => {
    serve({});
    await loadCorpus();
    expect(corpusEntry("abaci")).toBeDefined(); // first
    expect(corpusEntry("zymurgy")).toBeDefined(); // last
    expect(corpusEntry("abacus")).toBeDefined(); // middle
    for (const absent of ["aardvark", "zzz", "abac", "abacuses", ""]) {
      expect(corpusEntry(absent)).toBeUndefined();
    }
  });

  it("downloads once however many callers ask", async () => {
    serve({});
    const [a, b, c] = await Promise.all([loadCorpus(), loadCorpus(), loadCorpus()]);
    expect([a, b, c]).toEqual([true, true, true]);
    // five files, one round of them
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
    await loadCorpus();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
  });

  it("reports failure instead of throwing when the files can't be served", async () => {
    serve({ ok: false });
    expect(await loadCorpus()).toBe(false);
    expect(corpusReady()).toBe(false);
    expect(corpusEntry("abacus")).toBeUndefined();
  });
});

describe("refusing a corpus whose pieces disagree", () => {
  // Wrong tags are worse than no tags: they would put a misspelling into play
  // wearing a clean record, so every mismatch has to fail closed.
  it("refuses a word list shorter than meta says", async () => {
    serve({ count: 99 });
    expect(await loadCorpus()).toBe(false);
    expect(corpusReady()).toBe(false);
  });

  it("refuses a Zipf column that doesn't hold one byte per measured word", async () => {
    // Every byte after a gap would otherwise be read for the wrong word.
    const sources = new Array(WORDS.length).fill(0);
    sources[0] = sourceBit("wordfreq");
    sources[3] = sourceBit("norvig");
    serve({ sources, attested: [64] });
    expect(await loadCorpus()).toBe(false);
    resetCorpusForTests();
    serve({ sources, attested: [64, 48, 32] });
    expect(await loadCorpus()).toBe(false);
  });

  it("refuses a tags array that isn't index-aligned with the words", async () => {
    serve({ tags: [0, 0] });
    expect(await loadCorpus()).toBe(false);
  });

  it("refuses a tag order the client doesn't know how to read", async () => {
    serve({ tagOrder: ["misspelling", "proper-noun"] });
    expect(await loadCorpus()).toBe(false);
  });

  it("refuses a reordered source list, which would misread every bit", async () => {
    serve({ sourceOrder: [...CORPUS_SOURCES].reverse() });
    expect(await loadCorpus()).toBe(false);
  });
});

describe("what it says about a word", () => {
  it("reads tags and sources off the bitfields", async () => {
    const tags = new Array(WORDS.length).fill(0);
    const sources = new Array(WORDS.length).fill(0);
    tags[2] = tagBit("proper-noun") | tagBit("archaic");
    sources[2] = sourceBit("wiktionary") | sourceBit("norvig");
    serve({ tags, sources });
    await loadCorpus();
    const entry = corpusEntry("abacus");
    expect(tagsOf(entry!.tags)).toEqual(["proper-noun", "archaic"]);
    expect(sourcesOf(entry!.sources)).toEqual(["wiktionary", "norvig"]);
  });

  it("scales the zipf byte back, and reads 0 as unattested rather than as 0.0", async () => {
    const zipf = new Array(WORDS.length).fill(0);
    const sources = new Array(WORDS.length).fill(0);
    zipf[0] = 64; // 64 / 32
    sources[0] = sourceBit("wordfreq");
    serve({ zipf, sources });
    await loadCorpus();
    expect(corpusEntry("abaci")!.zipf).toBeCloseTo(2.0);
    // The distinction the whole scoring question rests on: a word nothing
    // attests has no frequency, which is not the same as a frequency of zero.
    expect(corpusEntry("aback")!.zipf).toBeNull();
  });
});
