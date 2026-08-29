import { describe, expect, it } from "vitest";
import { FIVE_MAX_GUESSES, LEGACY_MAX_GUESSES, MAX_GUESSES, maxGuessesFor } from "./constants";

describe("maxGuessesFor", () => {
  it("gives the last six-guess puzzle six", () => {
    expect(maxGuessesFor("2026-08-19")).toBe(LEGACY_MAX_GUESSES);
  });

  it("gives the first five-guess puzzle five", () => {
    expect(maxGuessesFor("2026-08-20")).toBe(FIVE_MAX_GUESSES);
  });

  it("gives the last five-guess puzzle five", () => {
    expect(maxGuessesFor("2026-08-29")).toBe(FIVE_MAX_GUESSES);
  });

  it("gives the first four-guess puzzle four", () => {
    expect(maxGuessesFor("2026-08-30")).toBe(MAX_GUESSES);
  });

  it("keeps every earlier archive puzzle on six", () => {
    expect(maxGuessesFor("2024-01-01")).toBe(LEGACY_MAX_GUESSES);
    expect(maxGuessesFor("2026-01-01")).toBe(LEGACY_MAX_GUESSES);
  });

  it("keeps later puzzles on four", () => {
    expect(maxGuessesFor("2027-01-01")).toBe(MAX_GUESSES);
  });

  // A missing date means the current system, matching how the scoring functions
  // in dictionary.ts treat one.
  it("treats a missing date as the current limit", () => {
    expect(maxGuessesFor()).toBe(MAX_GUESSES);
  });

  it("is four now, five before the second cutover, six before the first", () => {
    expect(MAX_GUESSES).toBe(4);
    expect(FIVE_MAX_GUESSES).toBe(5);
    expect(LEGACY_MAX_GUESSES).toBe(6);
  });
});
