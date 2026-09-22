import { describe, expect, it } from "vitest";
import { corpusAttests } from "./corpus";
import { rarityFor } from "./dictionary";

/**
 * The corpus era with no corpus: a cold first paint, or a player whose fetch
 * failed.
 *
 * Its own file because the loaded corpus is a module singleton, and the whole
 * claim here is about the state before anything loads it -- a `beforeAll` in a
 * file that also serves the corpus would be testing the wrong thing the moment
 * the suites were reordered.
 */
describe("the corpus lexicon before the corpus arrives", () => {
  it("prices a corpus-era puzzle exactly as the day before it", () => {
    // Nothing waits on the fetch, and a fold only ever caps, so the answer
    // before it lands is the pre-cutover one rather than a wrong one. The
    // direction is what makes that safe to ship: an unreachable base leaves a
    // word scoring higher, never lets through one it should have refused. See
    // `lexiconHas` in dictionary.ts.
    expect(corpusAttests("airy")).toBe(false);
    for (const word of ["actinomycetal", "antlion", "uglily", "verily", "porkiness"]) {
      expect(rarityFor(word, "2026-09-28")).toEqual(rarityFor(word, "2026-09-27"));
    }
  });
});
