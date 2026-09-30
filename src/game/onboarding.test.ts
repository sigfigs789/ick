import { beforeEach, describe, expect, it } from "vitest";
import {
  assignStartingMode,
  chooseStartingMode,
  parseSourceCode,
  resetFreshAssignment,
  shareCode,
  sharedModeFromSearch,
  takeFreshAssignment,
} from "./onboarding";
import { currentMode, resetModeCache, setMode } from "./mode";
import { arrivalSource, recordVisit } from "./visits";

const TODAY = "2026-09-30";
const HOST = "wordink.app";
const heads = () => 0.1;
const tails = () => 0.9;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetModeCache();
  resetFreshAssignment();
});

describe("share codes", () => {
  it("carry the mode after a dot", () => {
    expect(shareCode("sh", "freeform")).toBe("sh.f");
    expect(shareCode("t", "standard")).toBe("t.s");
  });

  it("parse back into a source and a mode", () => {
    expect(parseSourceCode("sh.f")).toEqual({ base: "sh", mode: "freeform" });
    expect(parseSourceCode("SH.S")).toEqual({ base: "sh", mode: "standard" });
    expect(parseSourceCode("sh")).toEqual({ base: "sh", mode: null });
    expect(parseSourceCode("sh.x")).toEqual({ base: "sh", mode: null });
    expect(parseSourceCode(null)).toEqual({ base: null, mode: null });
  });

  it("read a mode only off a share link", () => {
    expect(sharedModeFromSearch("?s=sh.f")).toBe("freeform");
    expect(sharedModeFromSearch("?s=t.s")).toBe("standard");
    expect(sharedModeFromSearch("?s=sh")).toBeNull();
    expect(sharedModeFromSearch("?s=r.f")).toBeNull();
  });

  it("leave the arrival source as the bare share code", () => {
    expect(arrivalSource("?s=sh.f", "", HOST)).toBe("sh");
    expect(arrivalSource("?s=t.s", "", HOST)).toBe("t");
  });
});

describe("chooseStartingMode", () => {
  it("follows the mode a friend shared", () => {
    expect(chooseStartingMode("?s=sh.f", "", HOST, tails)).toEqual({
      mode: "freeform",
      reason: "shared",
      source: "sh",
    });
    expect(chooseStartingMode("?s=t.s", "", HOST, heads)).toMatchObject({
      mode: "standard",
      reason: "shared",
    });
  });

  it("keeps Standard for a direct open or a share link with no mode", () => {
    expect(chooseStartingMode("", "", HOST, heads)).toEqual({
      mode: "standard",
      reason: "default",
      source: null,
    });
    expect(chooseStartingMode("?s=sh", "", HOST, heads)).toMatchObject({ reason: "default" });
    expect(chooseStartingMode("", `https://${HOST}/leaderboard`, HOST, heads)).toMatchObject({
      reason: "default",
    });
  });

  it("splits every other source down the middle", () => {
    expect(chooseStartingMode("", "https://www.reddit.com/r/wordgames", HOST, heads)).toEqual({
      mode: "freeform",
      reason: "split",
      source: "reddit",
    });
    expect(chooseStartingMode("?utm_source=newsletter", "", HOST, tails)).toEqual({
      mode: "standard",
      reason: "split",
      source: "newsletter",
    });
  });
});

describe("assignStartingMode", () => {
  it("starts a new player in the chosen mode and remembers it", () => {
    const assignment = assignStartingMode("?s=sh.f", TODAY, "", HOST, tails);
    expect(assignment).toEqual({ mode: "freeform", reason: "shared", source: "sh", date: TODAY });
    expect(currentMode()).toBe("freeform");
    resetModeCache();
    expect(currentMode()).toBe("freeform");
  });

  it("runs once: a second open keeps what the first picked", () => {
    assignStartingMode("", TODAY, "https://www.google.com/", HOST, heads);
    expect(assignStartingMode("?s=sh.s", TODAY, "", HOST, tails)).toBeNull();
    expect(currentMode()).toBe("freeform");
  });

  it("leaves a returning player alone", () => {
    recordVisit("", TODAY, "", HOST);
    expect(assignStartingMode("?s=sh.f", TODAY, "", HOST)).toBeNull();
    expect(currentMode()).toBe("standard");
  });

  it("leaves a player who has already chosen a mode alone", () => {
    setMode("freeform");
    expect(assignStartingMode("?s=sh.s", TODAY, "", HOST)).toBeNull();
    expect(currentMode()).toBe("freeform");
  });

  it("leaves a player with puzzles on record alone", () => {
    localStorage.setItem(
      "ick:progress:2026-09-29",
      JSON.stringify({ date: "2026-09-29", acceptedWords: [{ word: "cat" }] }),
    );
    expect(assignStartingMode("?s=sh.f", TODAY, "", HOST)).toBeNull();
  });

  it("hands the assignment to one reporter only", () => {
    const assignment = assignStartingMode("", TODAY, "", HOST);
    expect(takeFreshAssignment()).toEqual(assignment);
    expect(takeFreshAssignment()).toBeNull();
  });
});
