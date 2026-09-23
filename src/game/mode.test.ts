import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  FREEFORM_TRIAL_START,
  MODE_CHOICE_START,
  currentMode,
  freeformForDate,
  boardFor,
  countsOnBoard,
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

describe("which board a day counts on", () => {
  it("puts everything before the split on both", () => {
    // Those days were played before there was a choice to make -- the trial week
    // was freeform for everyone at once, and everything before it was standard
    // for everyone at once -- so each already ranked everyone who played it.
    // Splitting them now would halve one board and delete the other's history.
    setMode("freeform");
    expect(boardFor(IN_TRIAL, "freeform")).toBeNull();
    expect(boardFor(BEFORE_TRIAL, "standard")).toBeNull();
    for (const board of ["standard", "freeform"] as const) {
      expect(countsOnBoard(board, IN_TRIAL, "freeform")).toBe(true);
      expect(countsOnBoard(board, BEFORE_TRIAL, "standard")).toBe(true);
    }
  });

  it("sends a chosen day to its own board and no other", () => {
    expect(boardFor(AFTER_SWITCH, "freeform")).toBe("freeform");
    expect(boardFor(AFTER_SWITCH, "standard")).toBe("standard");
    expect(countsOnBoard("standard", AFTER_SWITCH, "freeform")).toBe(false);
    expect(countsOnBoard("freeform", AFTER_SWITCH, "freeform")).toBe(true);
    expect(countsOnBoard("freeform", AFTER_SWITCH, "standard")).toBe(false);
    expect(countsOnBoard("standard", AFTER_SWITCH, "standard")).toBe(true);
  });

  it("reads the mode off the record rather than the switch", () => {
    // A live lookup can settle after the player has flipped it, and the day
    // belongs to the game it was submitted to.
    setMode("freeform");
    expect(boardFor(AFTER_SWITCH, "standard")).toBe("standard");
    setMode("standard");
    expect(boardFor(AFTER_SWITCH, "freeform")).toBe("freeform");
  });

  it("falls back to the switch for a day with no mode on its record", () => {
    setMode("freeform");
    expect(boardFor(AFTER_SWITCH)).toBe("freeform");
    setMode("standard");
    expect(boardFor(AFTER_SWITCH)).toBe("standard");
  });
});

describe("naming a mode rather than reading the switch", () => {
  it("honours the name for a day the player chose", () => {
    setMode("freeform");
    expect(modeForDate(AFTER_SWITCH)).toBe("freeform");
    expect(modeForDate(AFTER_SWITCH, "standard")).toBe("standard");
    expect(freeformForDate(AFTER_SWITCH, "standard")).toBe(false);
  });

  it("ignores it for the trial week, which was nobody's choice", () => {
    // The override stands in for the switch and only for the switch. The finds
    // feed prices every word as Standard (see leaderboard.parseWords), and a
    // trial-week word still has to come back at what that week scored it.
    setMode("standard");
    expect(modeForDate(IN_TRIAL, "standard")).toBe("freeform");
    expect(freeformForDate(IN_TRIAL, "standard")).toBe(true);
    expect(modeForDate(BEFORE_TRIAL, "freeform")).toBe("standard");
  });
});
