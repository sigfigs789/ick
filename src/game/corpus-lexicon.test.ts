// @ts-expect-error -- Node builtin; this app has no @types/node, but the module
// is available at runtime under vitest (Node).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { corpusAttests, corpusEntry, loadCorpus, sourceBit, tagBit } from "./corpus";
import { baseFormSubstitution, rarityFor } from "./dictionary";
import { isRanked, modeForDate, resetModeCache, setMode } from "./mode";
import curated from "../data/dictionary.json";

/**
 * The shipped corpus, served to `loadCorpus` off disk.
 *
 * The real files rather than a fixture, because what this suite is checking is a
 * claim about the *data*: that the corpus reaches bases the curated list never
 * held, and that the strings it reaches are not names and fragments. A
 * hand-written six-word corpus can be made to say either.
 */
function serveShippedCorpus(): void {
  const base = "public/corpus";
  const meta = JSON.parse(readFileSync(`${base}/meta.json`, "utf8"));
  const words = readFileSync(`${base}/words.txt`, "utf8");
  const bin = (name: string) => {
    const b = readFileSync(`${base}/${name}`) as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.includes("meta.json")
        ? { json: () => Promise.resolve(meta) }
        : url.includes("words.txt")
          ? { text: () => Promise.resolve(words) }
          : { arrayBuffer: () => Promise.resolve(bin(url.split("/").pop()!.split("?")[0])) };
      return Promise.resolve({ ok: true, ...body } as unknown as Response);
    })
  );
}

/** The day before the cutover and the day of it -- see CORPUS_ONLY_START. */
const BEFORE = "2026-09-27";
const AFTER = "2026-09-28";

const CURATED = new Set(curated as string[]);

describe("the corpus lexicon (from 2026-09-28)", () => {
  beforeAll(async () => {
    serveShippedCorpus();
    expect(await loadCorpus()).toBe(true);
  });

  describe("what counts as a word the fold may price against", () => {
    it("takes a plain lexicon headword with a count behind it", () => {
      expect(corpusAttests("airy")).toBe(true);
    });

    it("refuses a name, however well attested", () => {
      // "airi" is a given name: a Wiktionary headword, counted by wordfreq at
      // 1.88, and the string that took "airily" from Uncommon to Extremely Rare
      // by standing in front of "airy".
      const entry = corpusEntry("airi")!;
      expect(entry.sources & sourceBit("wiktionary")).toBeTruthy();
      expect(entry.tags & tagBit("proper-noun")).toBeTruthy();
      expect(corpusAttests("airi")).toBe(false);
    });

    it("refuses a dead spelling", () => {
      expect(corpusEntry("destin")!.tags).not.toBe(0);
      expect(corpusAttests("destin")).toBe(false);
    });

    it("takes a headword nothing has ever counted", () => {
      // "curli" is a real Wiktionary entry (the bacterial fibre), untagged and
      // uncounted. It is admitted: `mostCommonBase` takes a maximum, so an
      // uncounted candidate can never be picked as a base, and the chain can
      // still walk *through* it to something common beyond. It once took
      // "curlily" from Uncommon to Legend, but the fault was
      // `scoringBaseForm` taking the first candidate rather than the most
      // common one -- see the "-ily" case below.
      expect(corpusEntry("curli")!.zipf).toBeNull();
      expect(corpusAttests("curli")).toBe(true);
    });

    it("is the widest lexicon that is still words", () => {
      // 790,130 headwords, against the 225,483 the fold used to be confined to.
      // Pinned loosely: what must not happen silently is the lexicon collapsing
      // back toward the size of the list it replaced, which is exactly what an
      // over-eager filter here did once.
      let admitted = 0;
      for (const word of curated as string[]) if (corpusAttests(word)) admitted++;
      expect(admitted).toBeGreaterThan(200_000);
    });

    it("refuses a string only the frequency corpora have seen", () => {
      // Counted, never described -- the objection `LEXICON_SOURCES` exists for.
      const crawl = ["mxps", "travelglobe"].filter((w) => corpusEntry(w));
      expect(crawl.length).toBeGreaterThan(0);
      for (const word of crawl) expect(corpusAttests(word)).toBe(false);
    });
  });

  describe("the archive", () => {
    it("prices a word the day before the cutover exactly as it always did", () => {
      // The corpus is loaded for every one of these and reaches none of them:
      // what the date gate buys is that a player opening an archived puzzle sees
      // the score it was played with.
      //
      // Against 2026-09-11 rather than the day before the cutover's own
      // neighbour, because 2026-09-26 is inside the freeform trial and does not
      // fold at all -- a real difference, and not this one.
      for (const word of ["airily", "curlily", "uglily", "porkiness", "antra", "bemuse"]) {
        expect(rarityFor(word, BEFORE)).toEqual(rarityFor(word, "2026-09-11"));
      }
    });

    it("leaves the overwhelming majority of the curated list where it was", () => {
      let moved = 0;
      for (const word of curated as string[]) {
        if (rarityFor(word, BEFORE)!.zipf !== rarityFor(word, AFTER)!.zipf) moved++;
      }
      // 2,910 of 225,483 -- see the PR body for the breakdown. Pinned as a range
      // so the data can be rebuilt without rewriting the test, and so a change
      // that suddenly moves ten times as much has to say so out loud.
      expect(moved).toBeGreaterThan(2_000);
      expect(moved).toBeLessThan(4_500);
    });
  });

  describe("what the cutover is for", () => {
    it("folds onto a base the curated list never held", () => {
      // The ceiling `rarityForUncurated` names: before the cutover every link of
      // the chain had to be one of the 225,483.
      const reached = (["actinomycetal", "antlion", "aparthotel"] as const).map((word) => ({
        word,
        before: baseFormSubstitution(word, BEFORE)?.base,
        after: baseFormSubstitution(word, AFTER)?.base,
      }));
      for (const { after } of reached) {
        expect(after).toBeDefined();
        expect(CURATED.has(after!)).toBe(false);
      }
      expect(reached.every(({ before, after }) => before !== after)).toBe(true);
    });

    it("only ever makes those words more common, never rarer", () => {
      for (const word of ["actinomycetal", "antlion", "aparthotel", "acyltransferase"]) {
        expect(rarityFor(word, AFTER)!.zipf).toBeGreaterThan(rarityFor(word, BEFORE)!.zipf);
      }
    });

    it("moves far more words down than up", () => {
      let down = 0;
      let up = 0;
      for (const word of curated as string[]) {
        const before = rarityFor(word, BEFORE)!.zipf;
        const after = rarityFor(word, AFTER)!.zipf;
        if (after > before) down++;
        else if (after < before) up++;
      }
      expect(down).toBeGreaterThan(2_000);
      // The promotions are named and accounted for in the PR body; what this
      // pins is that they stay a rounding error against the demotions rather
      // than becoming the story.
      expect(up).toBeLessThan(60);
      expect(up * 40).toBeLessThan(down);
    });

    it("leaves Freeform alone entirely, because Freeform does not fold", () => {
      // The mode switch lands on 2026-09-27 and this cutover on the 28th, so the
      // two are one day apart and it is worth saying which one owns what. The
      // switch decides whether a word folds; this decides what the fold may
      // reach. Freeform answers "it does not fold" to the first question, which
      // makes the second moot -- `lexiconHas` has exactly one consumer and it is
      // the fold.
      //
      // Swept over the whole list rather than spot-checked, because "no effect"
      // is the kind of claim a handful of words can pass by accident.
      resetModeCache();
      setMode("freeform");
      try {
        expect(modeForDate(AFTER)).toBe("freeform");
        let moved = 0;
        for (const word of curated as string[]) {
          if (rarityFor(word, BEFORE)!.zipf !== rarityFor(word, AFTER)!.zipf) moved++;
        }
        expect(moved).toBe(0);
      } finally {
        resetModeCache();
      }
    });

    it("leaves the mode switch itself working on both sides", () => {
      resetModeCache();
      setMode("standard");
      try {
        expect(modeForDate(BEFORE)).toBe("standard");
        expect(modeForDate(AFTER)).toBe("standard");
        expect(isRanked(AFTER, "standard")).toBe(true);
        expect(isRanked(AFTER, "freeform")).toBe(false);
      } finally {
        resetModeCache();
      }
    });

    it("keeps an '-ily' adverb on its adjective rather than on a homograph", () => {
      // "ugli" the fruit and "veri" are both corpus words with real counts, and
      // first-past-the-post handed them "uglily" and "verily". See
      // `scoringBaseForm`.
      expect(baseFormSubstitution("uglily", AFTER)?.base).toBe("ugly");
      expect(baseFormSubstitution("verily", AFTER)?.base).toBe("very");
      expect(rarityFor("uglily", AFTER)).toEqual(rarityFor("uglily", BEFORE));
      expect(rarityFor("verily", AFTER)).toEqual(rarityFor("verily", BEFORE));
    });
  });
});
