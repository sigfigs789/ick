import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODE_CHOICE_END,
  MODE_CHOICE_START,
  boardFor,
  countsOnBoard,
  currentMode,
  freeformForDate,
  loadMode,
  modeForDate,
  modeIsChosen,
  resetModeCache,
  setMode,
} from "./mode";

/** The last day Freeform can be chosen, and the first day it is gone. */
const LAST_CHOICE_DAY = "2026-11-09";

function today(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T12:00:00`));
}

beforeEach(() => {
  localStorage.clear();
  resetModeCache();
});

afterEach(() => vi.useRealTimers());

describe("Freeform retired from MODE_CHOICE_END", () => {
  it("starts with tomorrow's puzzle", () => {
    expect(MODE_CHOICE_END).toBe("2026-11-10");
  });

  it("still lets the player choose through the last day", () => {
    today(LAST_CHOICE_DAY);
    setMode("freeform");
    expect(currentMode()).toBe("freeform");
    expect(modeIsChosen(LAST_CHOICE_DAY)).toBe(true);
    expect(modeForDate(LAST_CHOICE_DAY)).toBe("freeform");
  });

  it("moves a player who had Freeform remembered to Standard, and forgets it", () => {
    localStorage.setItem("ick:mode", "freeform");
    today(MODE_CHOICE_END);
    expect(loadMode()).toBe("standard");
    expect(localStorage.getItem("ick:mode")).toBe("standard");
    expect(currentMode()).toBe("standard");
  });

  it("refuses a switch to Freeform", () => {
    today(MODE_CHOICE_END);
    setMode("freeform");
    expect(currentMode()).toBe("standard");
    expect(localStorage.getItem("ick:mode")).toBeNull();
  });

  it("plays every puzzle from the date on as Standard, whatever is asked", () => {
    today(LAST_CHOICE_DAY);
    setMode("freeform");
    expect(modeIsChosen(MODE_CHOICE_END)).toBe(false);
    expect(modeForDate(MODE_CHOICE_END)).toBe("standard");
    expect(modeForDate("2027-01-01", "freeform")).toBe("standard");
    expect(freeformForDate(MODE_CHOICE_END)).toBe(false);
  });

  it("puts those puzzles on the Standard board only", () => {
    expect(boardFor(MODE_CHOICE_END)).toBe("standard");
    expect(boardFor(MODE_CHOICE_END, "freeform")).toBe("standard");
    expect(countsOnBoard("standard", MODE_CHOICE_END)).toBe(true);
    expect(countsOnBoard("freeform", MODE_CHOICE_END)).toBe(false);
  });

  it("leaves the days before it exactly as they were played", () => {
    today(LAST_CHOICE_DAY);
    setMode("freeform");
    expect(modeForDate(MODE_CHOICE_START)).toBe("freeform");
    expect(modeForDate("2026-09-20")).toBe("freeform");
    expect(modeForDate("2026-09-13")).toBe("standard");
    expect(boardFor("2026-09-20")).toBeNull();
    expect(boardFor(LAST_CHOICE_DAY, "freeform")).toBe("freeform");
  });
});
