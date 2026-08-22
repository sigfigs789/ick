import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSession,
  endSessionSegment,
  markGuess,
  markShare,
  resumeSession,
} from "./sessionTime";

const START = new Date("2024-01-01T12:00:00Z").getTime();

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session timing", () => {
  it("reports the visible time from open to hide", () => {
    beginSession();
    const report = endSessionSegment(START + 45_000);
    expect(report).not.toBeNull();
    expect(report?.visibleMs).toBe(45_000);
    expect(report?.segmentMs).toBe(45_000);
    expect(report?.totalMs).toBe(45_000);
    expect(report?.reportNumber).toBe(1);
  });

  it("splits the session around the first guess", () => {
    beginSession();
    markGuess(START + 10_000);
    const report = endSessionSegment(START + 70_000);
    expect(report?.timeToFirstGuessMs).toBe(10_000);
    expect(report?.fromFirstGuessMs).toBe(60_000);
    expect(report?.guessed).toBe(true);
  });

  it("keeps the first guess time and follows the last one", () => {
    beginSession();
    markGuess(START + 5_000);
    markGuess(START + 20_000);
    markGuess(START + 26_000);

    const report = endSessionSegment(START + 30_000);
    expect(report?.timeToFirstGuessMs).toBe(5_000);
    expect(report?.timeToLastGuessMs).toBe(26_000);
    expect(report?.guessCount).toBe(3);
  });

  it("times the first share and ignores a second one", () => {
    beginSession();
    markGuess(START + 5_000);
    markShare(START + 40_000);
    markShare(START + 55_000);

    const report = endSessionSegment(START + 60_000);
    expect(report?.timeToShareMs).toBe(40_000);
    expect(report?.shared).toBe(true);
  });

  it("counts guess and share times in visible time only", () => {
    beginSession();
    // Twenty visible seconds, ten hidden minutes, then the guess and the share.
    endSessionSegment(START + 20_000);
    resumeSession(START + 620_000);
    markGuess(START + 630_000);
    markShare(START + 650_000);

    const report = endSessionSegment(START + 660_000);
    expect(report?.timeToFirstGuessMs).toBe(30_000);
    expect(report?.timeToLastGuessMs).toBe(30_000);
    expect(report?.timeToShareMs).toBe(50_000);
  });

  it("reports no first-guess split for a session that never guessed", () => {
    beginSession();
    const report = endSessionSegment(START + 30_000);
    expect(report?.guessed).toBe(false);
    expect(report?.timeToFirstGuessMs).toBeNull();
    expect(report?.fromFirstGuessMs).toBeNull();
    expect(report?.timeToLastGuessMs).toBeNull();
    expect(report?.guessCount).toBe(0);
    expect(report?.shared).toBe(false);
    expect(report?.timeToShareMs).toBeNull();
  });

  it("excludes hidden time and does not double-count across reports", () => {
    beginSession();
    const first = endSessionSegment(START + 20_000);
    // Ten minutes in the background, then twenty more seconds of play.
    resumeSession(START + 620_000);
    const second = endSessionSegment(START + 640_000);

    expect(first?.visibleMs).toBe(20_000);
    expect(second?.visibleMs).toBe(40_000);
    expect(second?.segmentMs).toBe(20_000);
    expect(second?.totalMs).toBe(640_000);
    expect(second?.reportNumber).toBe(2);
    expect(first?.sessionId).toBe(second?.sessionId);
  });

  it("stays silent for a hide with no new time", () => {
    beginSession();
    expect(endSessionSegment(START + 5_000)).not.toBeNull();
    expect(endSessionSegment(START + 5_100)).toBeNull();
  });

  it("banks sub-second time towards the next report rather than dropping it", () => {
    beginSession();
    expect(endSessionSegment(START + 600)).toBeNull();
    resumeSession(START + 700);
    expect(endSessionSegment(START + 1_400)?.visibleMs).toBe(1_300);
  });

  it("continues the same session across a reload", () => {
    beginSession();
    const first = endSessionSegment(START + 30_000);
    // A reload re-runs beginSession against the stored state.
    beginSession(START + 31_000);
    const second = endSessionSegment(START + 61_000);
    expect(second?.sessionId).toBe(first?.sessionId);
    expect(second?.visibleMs).toBe(60_000);
  });

  it("caps a visible stretch a browser never closed", () => {
    beginSession();
    // A machine asleep for four hours with the tab in front.
    expect(endSessionSegment(START + 4 * 60 * 60 * 1000)?.visibleMs).toBe(30 * 60 * 1000);
  });

  it("ignores a guess, a share, or a hide before the session started", () => {
    markGuess();
    markShare();
    expect(endSessionSegment(START + 10_000)).toBeNull();
  });
});
