import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSession,
  endSessionSegment,
  markFirstGuess,
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
    markFirstGuess(START + 10_000);
    const report = endSessionSegment(START + 70_000);
    expect(report?.timeToFirstGuessMs).toBe(10_000);
    expect(report?.fromFirstGuessMs).toBe(60_000);
    expect(report?.guessed).toBe(true);
  });

  it("keeps the first guess time when the player guesses again", () => {
    beginSession();
    markFirstGuess(START + 5_000);
    markFirstGuess(START + 20_000);
    expect(endSessionSegment(START + 30_000)?.timeToFirstGuessMs).toBe(5_000);
  });

  it("reports no first-guess split for a session that never guessed", () => {
    beginSession();
    const report = endSessionSegment(START + 30_000);
    expect(report?.guessed).toBe(false);
    expect(report?.timeToFirstGuessMs).toBeNull();
    expect(report?.fromFirstGuessMs).toBeNull();
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

  it("ignores a guess or a hide before the session started", () => {
    markFirstGuess();
    expect(endSessionSegment(START + 10_000)).toBeNull();
  });
});
