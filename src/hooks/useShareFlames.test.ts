import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isReporting, trackShareFlamesAssigned } from "../analytics";
import { rarityScore } from "../game/dictionary";
import type { AcceptedWord } from "../game/types";
import { useShareFlames } from "./useShareFlames";

vi.mock("../analytics", () => ({
  isReporting: vi.fn(() => true),
  trackShareFlamesAssigned: vi.fn(),
}));

const DATE = "2026-10-28";

/** A word that scores `score` under DATE (see shareFlamesTest.test.ts). */
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

describe("useShareFlames", () => {
  it("draws nobody while the average is below Extremely Rare", () => {
    const { result } = renderHook(() => useShareFlames([word(6)], DATE));
    expect(result.current).toBeNull();
    expect(localStorage.getItem("ick:share-flames-test")).toBeNull();
    expect(trackShareFlamesAssigned).not.toHaveBeenCalled();
  });

  it("draws a player once, when the average first reaches Extremely Rare, and reports it", () => {
    const { result, rerender } = renderHook(({ words }) => useShareFlames(words, DATE), {
      initialProps: { words: [word(6)] },
    });
    rerender({ words: [word(6), word(10)] });
    const arm = localStorage.getItem("ick:share-flames-test");
    expect(arm === "shown" || arm === "hidden").toBe(true);
    expect(result.current).toBe(arm === "shown" ? "Extremely Rare" : null);
    expect(trackShareFlamesAssigned).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackShareFlamesAssigned).mock.calls[0][0]).toBe(arm);

    rerender({ words: [word(10), word(10)] });
    expect(result.current).toBe(arm === "shown" ? "Legend" : null);
    expect(trackShareFlamesAssigned).toHaveBeenCalledTimes(1);
  });

  it("burns for a forced arm without drawing it", () => {
    window.history.pushState(null, "", "/?share-flames=shown");
    const { result } = renderHook(() => useShareFlames([word(9.6)], DATE));
    expect(result.current).toBe("Mythic");
    expect(localStorage.getItem("ick:share-flames-test")).toBeNull();
    expect(trackShareFlamesAssigned).not.toHaveBeenCalled();
  });

  it("keeps the plain buttons and draws nobody where nothing is reported", () => {
    vi.mocked(isReporting).mockReturnValue(false);
    const { result } = renderHook(() => useShareFlames([word(10)], DATE));
    expect(result.current).toBeNull();
    expect(localStorage.getItem("ick:share-flames-test")).toBeNull();
  });
});
