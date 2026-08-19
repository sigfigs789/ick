import { describe, expect, it } from "vitest";
import { LIVE_CHECK_NOTE } from "./useDailyPuzzle";

describe("live check note", () => {
  it("moves from an in-progress form to a settled one", () => {
    // The in-progress form trails off; the finished ones are a full stop.
    expect(LIVE_CHECK_NOTE.pending.endsWith("…")).toBe(true);
    expect(LIVE_CHECK_NOTE.found.endsWith(".")).toBe(true);
    expect(LIVE_CHECK_NOTE.notFound.endsWith(".")).toBe(true);
    expect(LIVE_CHECK_NOTE.found).not.toBe(LIVE_CHECK_NOTE.notFound);
  });

  it("says what the search is doing, and says so plainly", () => {
    expect(LIVE_CHECK_NOTE.pending).toBe("Scouring dictionaries…");
    expect(LIVE_CHECK_NOTE.notFound).toBe("Not found.");
  });

  it("reports on the search rather than judging the word", () => {
    // A word can be perfectly good and still be one no reference here carries,
    // so nothing here may claim a word is or isn't real.
    for (const form of [LIVE_CHECK_NOTE.found, LIVE_CHECK_NOTE.notFound]) {
      expect(form).not.toMatch(/valid|real|verified|exists?\b/i);
    }
  });

  it("names no particular reference", () => {
    // A generic "dictionaries" is fine; naming the fallback would tell players
    // exactly which book to fish in.
    const words = [
      LIVE_CHECK_NOTE.pending,
      LIVE_CHECK_NOTE.found,
      LIVE_CHECK_NOTE.notFound,
    ].join(" ");
    expect(words).not.toMatch(/webster|merriam|collegiate|curated list/i);
  });
});
