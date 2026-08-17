import { describe, expect, it } from "vitest";
import { LIVE_CHECK_NOTES } from "./useDailyPuzzle";

describe("live check notes", () => {
  it("pairs every in-progress verb with a distinct past tense", () => {
    for (const note of LIVE_CHECK_NOTES) {
      expect(note.pending).not.toBe(note.done);
      // The in-progress form trails off; the finished one is a full stop.
      expect(note.pending.endsWith("…")).toBe(true);
      expect(note.done.endsWith(".")).toBe(true);
    }
  });

  it("keeps every verb unique so the rotation never repeats itself", () => {
    const pending = LIVE_CHECK_NOTES.map((note) => note.pending);
    expect(new Set(pending).size).toBe(pending.length);
  });

  it("says nothing about where the game is looking", () => {
    // Naming a dictionary would advertise the fallback; these must stay vague.
    const words = LIVE_CHECK_NOTES.flatMap((note) => [note.pending, note.done]).join(" ");
    expect(words).not.toMatch(/dictionar|webster|list|word/i);
  });
});
