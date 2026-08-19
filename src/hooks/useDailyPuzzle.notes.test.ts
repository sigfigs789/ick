import { describe, expect, it } from "vitest";
import { LIVE_CHECK_PENDING, LIVE_CHECK_SETTLED } from "./useDailyPuzzle";

const ALL = [...LIVE_CHECK_PENDING, LIVE_CHECK_SETTLED.found, LIVE_CHECK_SETTLED.notFound];

describe("live check notes", () => {
  it("trails off while the search runs, and stops trailing once it settles", () => {
    // That ellipsis is what earns a line the animated dots in FeedbackRegion,
    // so every in-progress line needs one and no settled line may have one.
    for (const line of LIVE_CHECK_PENDING) {
      expect(line.endsWith("…")).toBe(true);
    }
    expect(LIVE_CHECK_SETTLED.found.endsWith("…")).toBe(false);
    expect(LIVE_CHECK_SETTLED.notFound.endsWith("…")).toBe(false);
  });

  it("keeps enough in-progress lines that a session rarely repeats one", () => {
    expect(LIVE_CHECK_PENDING.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps every in-progress line unique so the rotation never repeats itself", () => {
    expect(new Set(LIVE_CHECK_PENDING).size).toBe(LIVE_CHECK_PENDING.length);
  });

  it("opens the rotation on the tomes", () => {
    expect(LIVE_CHECK_PENDING[0]).toBe("Consulting the tomes…");
  });

  it("settles the same way every time, so a verdict is legible at a glance", () => {
    expect(LIVE_CHECK_SETTLED.found).toBe("Found it!");
    expect(LIVE_CHECK_SETTLED.notFound).toBe("Not found");
  });

  it("reports on the search rather than judging the word", () => {
    // A word can be perfectly good and still be one no reference here carries,
    // so nothing here may claim a word is or isn't real.
    for (const line of ALL) {
      expect(line).not.toMatch(/valid|real|verified|exists?\b/i);
    }
  });

  it("names no particular reference", () => {
    // A generic "dictionaries" or "tomes" is fine; naming the fallback would
    // tell players exactly which book to fish in.
    expect(ALL.join(" ")).not.toMatch(/webster|merriam|collegiate|curated list/i);
  });
});
