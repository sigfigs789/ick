import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  FREEFORM_TRIAL_START,
  MODE_CHOICE_START,
  currentMode,
  freeformForDate,
  loadMode,
  modeForDate,
  modeIsChosen,
  otherMode,
  resetModeCache,
  setMode,
  subscribeToMode,
} from "./mode";

/** A day before the trial, one inside it, and one after the switch arrives. */
const BEFORE_TRIAL = "2026-09-13";
const IN_TRIAL = "2026-09-20";
const AFTER_SWITCH = MODE_CHOICE_START;

beforeEach(() => {
  localStorage.clear();
  resetModeCache();
});

describe("the chosen mode", () => {
  it("is Standard for a player who has never touched the switch", () => {
    // The folding system is the game as it has been for months and as every
    // archived puzzle scored; Freeform is the variant.
    expect(loadMode()).toBe("standard");
    expect(currentMode()).toBe(DEFAULT_MODE);
  });

  it("is remembered across sessions", () => {
    setMode("freeform");
    // A fresh read of storage, as a reload would do.
    resetModeCache();
    expect(currentMode()).toBe("freeform");
  });

  it("is Standard again for a browser holding nonsense", () => {
    localStorage.setItem("ick:mode", "hardcore");
    expect(loadMode()).toBe("standard");
  });

  it("tells subscribers, because scoring reads it as a module variable", () => {
    const seen: string[] = [];
    const stop = subscribeToMode((mode) => seen.push(mode));
    setMode("freeform");
    // The same mode again is not a change, and re-rendering the whole app for
    // it would be a repaint nobody asked for.
    setMode("freeform");
    setMode("standard");
    stop();
    setMode("freeform");
    expect(seen).toEqual(["freeform", "standard"]);
  });

  it("names the other one, for the control whose whole job is swapping them", () => {
    expect(otherMode("standard")).toBe("freeform");
    expect(otherMode("freeform")).toBe("standard");
  });
});

describe("which mode a puzzle is in", () => {
  it("lets the calendar decide before the choice date", () => {
    // Both of these are frozen facts about archived puzzles, so they have to
    // hold whatever the switch currently says.
    setMode("freeform");
    expect(modeForDate(BEFORE_TRIAL)).toBe("standard");
    expect(modeForDate(FREEFORM_TRIAL_START)).toBe("freeform");
    expect(modeForDate(IN_TRIAL)).toBe("freeform");

    setMode("standard");
    expect(modeForDate(IN_TRIAL)).toBe("freeform");
    expect(modeForDate(BEFORE_TRIAL)).toBe("standard");
  });

  it("lets the player decide from the choice date on", () => {
    expect(modeForDate(AFTER_SWITCH)).toBe("standard");
    setMode("freeform");
    expect(modeForDate(AFTER_SWITCH)).toBe("freeform");
  });

  it("says which era a date is in", () => {
    expect(modeIsChosen(IN_TRIAL)).toBe(false);
    expect(modeIsChosen(AFTER_SWITCH)).toBe(true);
  });

  it("answers the fold question the same way", () => {
    // Scoring and the record have to agree about a day, or a player banks a
    // Freeform word onto the Standard board.
    setMode("freeform");
    expect(freeformForDate(AFTER_SWITCH)).toBe(true);
    expect(freeformForDate(BEFORE_TRIAL)).toBe(false);
    setMode("standard");
    expect(freeformForDate(AFTER_SWITCH)).toBe(false);
    expect(freeformForDate(IN_TRIAL)).toBe(true);
  });
});
