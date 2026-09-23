// @ts-expect-error -- Node builtin; this app has no @types/node, but the module
// is available at runtime under vitest (Node).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { corpusAttests, corpusEntry, loadCorpus, sourceBit, tagBit } from "./corpus";
import { baseFormSubstitution, foldTrace, rarityFor } from "./dictionary";
import { MODE_CHOICE_START, isRanked, modeForDate, resetModeCache, setMode } from "./mode";
import { sameRootKey } from "./submit";
import curated from "../data/dictionary.json";
import rarity from "../data/rarity.json";
import foldExemptionData from "../data/fold-exemptions.json";

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

/**
 * The day of the cutover and the last ordinary folding puzzle before it -- see
 * CORPUS_ONLY_START. "Before" cannot be the day before, because that is inside
 * the freeform trial, where nothing folds at all and every comparison would read
 * as the whole fold arriving at once. 2026-09-13 is the system this cutover
 * changes, which is the substitution every other cutover's tests make.
 *
 * The date now carries the mode switch, the ungated prefixes and the restored
 * "pre-" as well, so the counts below are the day's, not the corpus's alone: of
 * the words that move, 530 carry "anti-"/"counter-" and 854 carry "pre-". What
 * the corpus does on its own is still what the named cases pin.
 */
const BEFORE = "2026-09-13";
const AFTER = MODE_CHOICE_START;

const CURATED = new Set(curated as string[]);

describe("the corpus lexicon (from MODE_CHOICE_START)", () => {
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
      // 4,954 of 225,483. The ceiling was 4,500 while the corpus moved this
      // list alone; the 2026-09-22 audit's exemptions now land on the same date
      // and carry their inflections with them, which is the whole of the
      // difference. Still pinned as a range, for the reason it always was: the
      // data can be rebuilt without rewriting the test, and a change that
      // suddenly moves ten times as much has to say so out loud.
      expect(moved).toBeGreaterThan(2_000);
      expect(moved).toBeLessThan(6_500);
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

    it("moves far more words down than up, once the reviewed fixes are set aside", () => {
      // Two changes land on this date and they pull opposite ways. The corpus
      // reaches bases the curated list never held, which makes words commoner.
      // The 2026-09-22 semantic audit withdraws folds that were landing on the
      // wrong word, which makes them rarer. Summed, the second swamps the ratio
      // the first exists to state.
      //
      // So they are counted apart. The question this test is for is whether the
      // *corpus* quietly promoted anything nobody reviewed, and loosening the
      // ceiling to fit the sum would have destroyed it: a ceiling wide enough
      // for the audit is wide enough for an unreviewed promotion to hide in,
      // which is the one thing this refuses.
      //
      // Accounted-for two ways, because an entry reaches a word two ways.
      // Mostly by root: "abasers" does not fold *through* "abaser", it is
      // another member of its paradigm, and withdrawing the base's fold
      // withdraws the family's -- `sameRootKey` is what the game already uses
      // to call two submissions the same word. The rest by chain, for the
      // handful whose route to a base ran through an entry of another root.
      const audited = new Set(
        Object.entries(foldExemptionData)
          .filter(([, entry]) => (entry as { since: string }).since === AFTER)
          .map(([word]) => word)
      );
      const auditedRoots = new Set([...audited].map((word) => sameRootKey(word, AFTER)));

      let down = 0;
      let unreviewedUp = 0;
      let reviewedUp = 0;
      for (const word of curated as string[]) {
        const before = rarityFor(word, BEFORE)!.zipf;
        const after = rarityFor(word, AFTER)!.zipf;
        if (after > before) down++;
        else if (after < before) {
          const reached = foldTrace(word, BEFORE)?.path ?? [];
          if (
            audited.has(word) ||
            auditedRoots.has(sameRootKey(word, AFTER)) ||
            reached.some((hop) => audited.has(hop.to))
          ) {
            reviewedUp++;
          } else {
            unreviewedUp++;
          }
        }
      }
      expect(down).toBeGreaterThan(2_000);
      // The audit is the larger half of the day, and is meant to be.
      expect(reviewedUp).toBeGreaterThan(500);
      // What is left is the corpus's own doing, and it stays a rounding error
      // against its demotions rather than becoming the story.
      expect(unreviewedUp).toBeLessThan(60);
      expect(unreviewedUp * 40).toBeLessThan(down);
    });

    it("leaves Freeform alone entirely, because Freeform does not fold", () => {
      // The mode switch and this cutover now land on the same date, and it is
      // still worth saying which one owns what. The switch decides whether a
      // word folds; this decides what the fold may reach. Freeform answers "it
      // does not fold" to the first question, which makes the second moot --
      // `lexiconHas` has exactly one consumer and it is the fold.
      //
      // Stated as "every word scores its own measurement" rather than as a
      // before/after diff, because there is no longer a day between the two
      // cutovers to take the "before" from: the corpus arrives on the first date
      // the switch exists. This says the same thing more directly.
      //
      // Swept over the whole list rather than spot-checked, because "no effect"
      // is the kind of claim a handful of words can pass by accident.
      resetModeCache();
      setMode("freeform");
      try {
        expect(modeForDate(AFTER)).toBe("freeform");
        let folded = 0;
        (curated as string[]).forEach((word, i) => {
          if (rarityFor(word, AFTER)!.zipf !== rarity.zipfHundredths[i] / 100) folded++;
        });
        expect(folded).toBe(0);
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

    it("carries the ungated prefixes onto bases only the corpus has", () => {
      // The two cutovers compose, a day apart: 2026-09-27 lets "anti-" strip a
      // measured word at all (see UNGATED_PREFIX_START), and this one decides
      // what the strip may land on. `christ` is a corpus headword with no tag
      // against it and no curated entry, so the pair of them is what gets
      // "antichrist" onto it.
      expect(CURATED.has("christ")).toBe(false);
      expect(corpusAttests("christ")).toBe(true);
      expect(baseFormSubstitution("antichrist", BEFORE)?.base).toBeUndefined();
      expect(baseFormSubstitution("antichrist", AFTER)?.base).toBe("christ");
      // And a residue the lexicon refuses is still refused with the prefix off
      // the gate: "arin" is a name, so "antiarin" needs no exemption of its own.
      expect(corpusAttests("arin")).toBe(false);
      expect(baseFormSubstitution("antiarin", AFTER)?.base).toBeUndefined();
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
