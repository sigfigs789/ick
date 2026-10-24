import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle, VISIT_STREAK_DELAY_MS } from "./useDailyPuzzle";
import { loadStreak } from "../game/storage";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

const TODAY = "2026-09-15";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  setVisibility("visible");
});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("useDailyPuzzle visit streak", () => {
  it("counts today once the site has been open a moment, and rolls the count up", () => {
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => void vi.advanceTimersByTime(VISIT_STREAK_DELAY_MS - 100));
    expect(result.current.streak.currentStreak).toBe(0);

    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.streak.currentStreak).toBe(1);
    expect(result.current.streak.lastCompletedDate).toBe(TODAY);
    expect(result.current.streakRolledFrom).toBe(0);

    // The roll is told once, then settles.
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.streakRolledFrom).toBeNull();
  });

  it("only counts time the tab is visible", () => {
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => void vi.advanceTimersByTime(VISIT_STREAK_DELAY_MS / 2));
    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(VISIT_STREAK_DELAY_MS * 5));
    expect(loadStreak().currentStreak).toBe(0);

    // Back in view, the clock starts over.
    act(() => setVisibility("visible"));
    act(() => void vi.advanceTimersByTime(VISIT_STREAK_DELAY_MS - 1));
    expect(result.current.streak.currentStreak).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.streak.currentStreak).toBe(1);
  });

  it("does not roll for a day already counted", () => {
    localStorage.setItem(
      "ick:streak",
      JSON.stringify({
        currentStreak: 3,
        longestStreak: 3,
        totalCompleted: 0,
        crushedIt: 0,
        elite: 0,
        highScore: 0,
        lastCompletedDate: TODAY,
      })
    );
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => void vi.advanceTimersByTime(VISIT_STREAK_DELAY_MS * 2));
    expect(result.current.streak.currentStreak).toBe(3);
    expect(result.current.streakRolledFrom).toBeNull();
  });
});
