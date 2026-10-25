import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAcceptedSuggestions } from "./useAcceptedSuggestions";
import { claimHeaderCelebration } from "../game/headerCelebrations";
import { todayDateString } from "../game/date";
import { SUGGESTIONS_KEY } from "../game/suggestions";

vi.mock("../game/player", () => ({ loadPlayerId: () => null }));

function accept(...words: string[]): void {
  localStorage.setItem(
    SUGGESTIONS_KEY,
    JSON.stringify({
      checkedAt: Date.now(),
      words: words.map((word) => ({
        word,
        suggestedOn: "2026-10-01",
        acceptedOn: "2026-10-20",
        thanked: false,
      })),
    })
  );
}

describe("useAcceptedSuggestions", () => {
  beforeEach(() => localStorage.clear());

  it("thanks for every accepted word together on a quiet day", async () => {
    accept("zibeline", "snollygoster");
    const { result } = renderHook(() => useAcceptedSuggestions(false));
    await waitFor(() => expect(result.current.words).toEqual(["zibeline", "snollygoster"]));
    expect(result.current.firstAcceptance).toBe(true);
  });

  it("shows a set of words once, closed or not, and again only for a new word", async () => {
    accept("zibeline", "snollygoster");
    const first = renderHook(() => useAcceptedSuggestions(false));
    await waitFor(() => expect(first.result.current.words).toEqual(["zibeline", "snollygoster"]));
    first.unmount();

    // A reload, never having closed it: the same words are not announced again.
    const again = renderHook(() => useAcceptedSuggestions(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(again.result.current.words).toEqual([]);
    again.unmount();

    // A word accepted later brings the notice back, for that word alone.
    const stored = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY)!);
    stored.words.push({ word: "quockerwodger", suggestedOn: "2026-10-02", acceptedOn: "2026-10-24", thanked: false });
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(stored));
    const later = renderHook(() => useAcceptedSuggestions(false));
    await waitFor(() => expect(later.result.current.words).toEqual(["quockerwodger"]));
    expect(later.result.current.firstAcceptance).toBe(false);
  });

  it("waits for another day once a header celebration has shown today", async () => {
    accept("zibeline");
    claimHeaderCelebration("news", todayDateString());
    const { result, rerender } = renderHook(() => useAcceptedSuggestions(false));
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.words).toEqual([]);
  });

  it("waits for another day when something else is on screen", async () => {
    accept("zibeline");
    const { result, rerender } = renderHook(({ busy }) => useAcceptedSuggestions(busy), {
      initialProps: { busy: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    rerender({ busy: false });
    expect(result.current.words).toEqual([]);
  });
});
