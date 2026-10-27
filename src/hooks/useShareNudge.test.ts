import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isReporting, trackShareNudgeAssigned } from "../analytics";
import { rarityScore } from "../game/dictionary";
import type { AcceptedWord } from "../game/types";
import { useShareNudge } from "./useShareNudge";

vi.mock("../analytics", () => ({
  isReporting: vi.fn(() => true),
  trackShareNudgeAssigned: vi.fn(),
}));

const DATE = "2026-10-27";
const KEY = "ick:share-nudge-test";

/** A word scoring about `target` on DATE (scores fall as Zipf rises). */
function wordScoring(target: number): AcceptedWord {
  let low = -2;
  let high = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (rarityScore(mid, DATE) > target) low = mid;
    else high = mid;
  }
  return { word: "word", rarity: "Extremely Rare", zipf: (low + high) / 2 };
}

const GREAT = [wordScoring(8.5), wordScoring(9.2)];
const GOOD = [wordScoring(9.6), wordScoring(5)];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isReporting).mockReturnValue(true);
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("useShareNudge", () => {
  it("draws a player once, on a great finish of the live puzzle, and reports it", () => {
    const first = renderHook(() => useShareNudge(DATE, true, true, GREAT));
    const arm = localStorage.getItem(KEY);
    expect(arm === "shown" || arm === "hidden").toBe(true);
    expect(first.result.current).toBe(arm === "shown");
    expect(trackShareNudgeAssigned).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackShareNudgeAssigned).mock.calls[0][0]).toBe(arm);
    expect(vi.mocked(trackShareNudgeAssigned).mock.calls[0][2]).toBe(false);

    first.unmount();
    renderHook(() => useShareNudge(DATE, true, true, GREAT));
    expect(trackShareNudgeAssigned).toHaveBeenCalledTimes(1);
  });

  it("never draws a player short of an Extremely Rare average", () => {
    const { result } = renderHook(() => useShareNudge(DATE, true, true, GOOD));
    expect(result.current).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(trackShareNudgeAssigned).not.toHaveBeenCalled();
  });

  it("never draws on an unfinished puzzle or an archived one", () => {
    renderHook(() => useShareNudge(DATE, true, false, GREAT));
    renderHook(() => useShareNudge(DATE, false, true, GREAT));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(trackShareNudgeAssigned).not.toHaveBeenCalled();
  });

  it("draws the moment a great puzzle is finished", () => {
    const { result, rerender } = renderHook(({ completed }) => useShareNudge(DATE, true, completed, GREAT), {
      initialProps: { completed: false },
    });
    expect(localStorage.getItem(KEY)).toBeNull();
    window.history.pushState(null, "", "/?share-nudge=shown");
    rerender({ completed: true });
    expect(result.current).toBe(true);
  });

  it("shows a forced arm without drawing it, and only on a great finish", () => {
    window.history.pushState(null, "", "/?share-nudge=shown");
    expect(renderHook(() => useShareNudge(DATE, true, true, GREAT)).result.current).toBe(true);
    expect(renderHook(() => useShareNudge(DATE, true, true, GOOD)).result.current).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(trackShareNudgeAssigned).not.toHaveBeenCalled();
  });

  it("keeps the Share still and draws nobody where nothing is reported", () => {
    vi.mocked(isReporting).mockReturnValue(false);
    const { result } = renderHook(() => useShareNudge(DATE, true, true, GREAT));
    expect(result.current).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
