import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isReporting, trackShareTintAssigned } from "../analytics";
import { rarityScore } from "../game/dictionary";
import type { AcceptedWord } from "../game/types";
import { useShareTint } from "./useShareTint";

vi.mock("../analytics", () => ({
  isReporting: vi.fn(() => true),
  trackShareTintAssigned: vi.fn(),
}));

const DATE = "2026-10-28";

/** A word that scores `score` under DATE (see shareTintTest.test.ts). */
function word(score: number): AcceptedWord {
  let common = 8;
  let rare = -2;
  for (let step = 0; step < 60; step++) {
    const mid = (common + rare) / 2;
    if (rarityScore(mid, DATE) >= score) rare = mid;
    else common = mid;
  }
  return { word: "x", rarity: "Common", zipf: rare };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isReporting).mockReturnValue(true);
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("useShareTint", () => {
  it("draws nobody while the average is not Extremely Rare", () => {
    const { result } = renderHook(() => useShareTint([word(6)], DATE));
    expect(result.current).toBe(false);
    expect(localStorage.getItem("ick:share-tint-test")).toBeNull();
    expect(trackShareTintAssigned).not.toHaveBeenCalled();
  });

  it("draws a player once, when the average first reaches Extremely Rare, and reports it", () => {
    const { result, rerender } = renderHook(({ words }) => useShareTint(words, DATE), {
      initialProps: { words: [word(6)] },
    });
    rerender({ words: [word(8.2), word(8.6)] });
    const arm = localStorage.getItem("ick:share-tint-test");
    expect(arm === "shown" || arm === "hidden").toBe(true);
    expect(result.current).toBe(arm === "shown");
    expect(trackShareTintAssigned).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackShareTintAssigned).mock.calls[0][0]).toBe(arm);

    rerender({ words: [word(10), word(10)] });
    expect(result.current).toBe(false);
    expect(trackShareTintAssigned).toHaveBeenCalledTimes(1);
  });

  it("tints for a forced arm without drawing it", () => {
    window.history.pushState(null, "", "/?share-tint=shown");
    const { result } = renderHook(() => useShareTint([word(8.4)], DATE));
    expect(result.current).toBe(true);
    expect(localStorage.getItem("ick:share-tint-test")).toBeNull();
    expect(trackShareTintAssigned).not.toHaveBeenCalled();
  });

  it("keeps the plain buttons and draws nobody where nothing is reported", () => {
    vi.mocked(isReporting).mockReturnValue(false);
    const { result } = renderHook(() => useShareTint([word(8.4)], DATE));
    expect(result.current).toBe(false);
    expect(localStorage.getItem("ick:share-tint-test")).toBeNull();
  });
});
