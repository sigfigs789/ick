import { describe, expect, it } from "vitest";
import {
  FIVE_MAX_GUESSES,
  LEGACY_MAX_GUESSES,
  MAX_GUESSES,
  maxGuessesFor,
  retryAvailableFor,
} from "./constants";

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

describe("retryAvailableFor", () => {
  it("gives the first puzzle of the feature a retry", () => {
    expect(retryAvailableFor("2026-09-04")).toBe(true);
  });

  it("withholds it from the day before", () => {
    // The day before this shipped. A puzzle plays the way it did when it
    // dropped, and this one dropped without a retry.
    expect(retryAvailableFor("2026-09-03")).toBe(false);
  });

  it("withholds it from every earlier puzzle", () => {
    expect(retryAvailableFor("2026-07-01")).toBe(false);
    expect(retryAvailableFor("2026-08-30")).toBe(false);
    expect(retryAvailableFor("2024-01-01")).toBe(false);
  });

  it("keeps every later puzzle carrying one", () => {
    expect(retryAvailableFor("2026-09-05")).toBe(true);
    expect(retryAvailableFor("2027-01-01")).toBe(true);
  });

  // A missing date means the current puzzle, matching maxGuessesFor above and
  // the scoring functions in dictionary.ts.
  it("treats a missing date as the current puzzle", () => {
    expect(retryAvailableFor()).toBe(true);
  });
});
