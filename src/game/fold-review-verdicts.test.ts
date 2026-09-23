// The wiring between the fold review page's exported file and the scoring.
//
// Its own suite with the data module mocked, because the shipped file starts
// empty and stays small: a test reading whatever happens to be in it would pass
// by saying nothing. What has to hold is that an entry does what the page
// promised the reviewer it would do -- a recommended base redirects the fold, a
// verdict with no base stops it -- and that both wait for their `since`.

import { describe, expect, it, vi } from "vitest";

vi.mock("../data/fold-review-verdicts.json", () => ({
  default: {
    // "timelessly" folds to "time"; the reviewer said it should fold to
    // "timeless", which is a hop the chain stopped short of.
    timelessly: { base: "timeless", since: "2026-10-01", reason: "reviewed at /fold" },
    // A fold rejected with nothing recommended: score it on its own data.
    lastings: { base: null, since: "2026-10-01", reason: "reviewed at /fold" },
  },
}));

const { baseFormSubstitution, rarityFor } = await import("./dictionary");

/** A puzzle after the verdicts, and one before them. */
const ON = "2026-10-02";
const BEFORE = "2026-09-30";

describe("reviewed fold verdicts", () => {
  it("redirects a fold to the base the reviewer named, and stops there", () => {
    const fold = baseFormSubstitution("timelessly", ON);
    expect(fold?.base).toBe("timeless");
    // The score comes from that base and no further. "timeless" has a fold of
    // its own -- the engine reads it as "time" -- and following it would hand
    // "timelessly" back the exact fold the reviewer rejected. A recommendation
    // names the frequency to score the word at; it is not a hint about where to
    // look next. Whether "timeless" should fold to "time" is its own row.
    expect(rarityFor("timelessly", ON)?.zipf).toBe(fold?.baseZipf);
    expect(rarityFor("timelessly", ON)?.zipf).not.toBe(rarityFor("timeless", ON)?.zipf);
  });

  it("stops a fold the reviewer rejected without naming a base", () => {
    expect(baseFormSubstitution("lastings", ON)).toBeUndefined();
  });

  it("leaves the puzzles before its since date exactly as they were", () => {
    // Dated like every other scoring table: a verdict applies from the puzzle it
    // was exported for onward, and an archived puzzle keeps what it showed.
    expect(baseFormSubstitution("timelessly", BEFORE)?.base).not.toBe("timeless");
    expect(baseFormSubstitution("lastings", BEFORE)).toBeDefined();
  });
});
