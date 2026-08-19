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

  it("says the search is verifying, and says so plainly", () => {
    expect(LIVE_CHECK_NOTE.pending).toBe("Verifying…");
    expect(LIVE_CHECK_NOTE.notFound).toBe("Not found.");
  });

  it("says nothing about where the game is looking", () => {
    // Naming a dictionary would advertise the fallback; these must stay vague.
    const words = [
      LIVE_CHECK_NOTE.pending,
      LIVE_CHECK_NOTE.found,
      LIVE_CHECK_NOTE.notFound,
    ].join(" ");
    expect(words).not.toMatch(/dictionar|webster|list|word/i);
  });
});
