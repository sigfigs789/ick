import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { dropForDate } from "../game/drop";
import {
  isUnattestedZipf,
  isValidWord,
  rarityFor,
  rarityScore,
  unattestedZipf,
} from "../game/dictionary";
import { resetLiveCheckSession } from "../game/liveValidate";
import dictionaryWords from "../data/dictionary.json";
import rarityData from "../data/rarity.json";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

// This suite needs a curated word whose stored score is the unattested
// stand-in. The latest inflection fold can legitimately rescue every such word
// in a particular day's drop, so use a pre-fold puzzle date rather than making
// the analytics assertions depend on today's rotation.
const PUZZLE_DATE = "2026-08-20";
const DROP = dropForDate(PUZZLE_DATE).toLowerCase();
const OFF_LIST_WORD = `${DROP}qxz`;

/** Every `unattested_score_used` payload fired so far. */
function unattestedEvents(): Record<string, unknown>[] {
  return track.mock.calls
    .filter(([event]) => event === "unattested_score_used")
    .map(([, payload]) => payload as Record<string, unknown>);
}

/** A curated word playable today whose score is (or is not) a stand-in. */
function curatedWord(wantStandIn: boolean): string {
  const words = dictionaryWords as unknown as string[];
  const hundredths = rarityData.zipfHundredths;
  for (let i = 0; i < hundredths.length; i++) {
    const word = words[i];
    if (!word.includes(DROP) || word === DROP) continue;
    const info = rarityFor(word, PUZZLE_DATE);
    if (info && isUnattestedZipf(info.zipf) === wantStandIn) return word;
  }
  throw new Error(`no curated ${wantStandIn ? "stand-in" : "measured"} word for "${DROP}"`);
}

function stubValidate(zipf: number | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      url: `${location.origin}/api/validate`,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        word: OFF_LIST_WORD,
        outcome: "playable",
        reason: null,
        zipf,
        pos: ["noun"],
        firstUse: "1961",
      }),
    })) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${PUZZLE_DATE}T12:00:00`));
  localStorage.clear();
  sessionStorage.clear();
  resetLiveCheckSession();
  track.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("unattested-score tracking", () => {
  it("records a curated word whose score is a stand-in", async () => {
    const word = curatedWord(true);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(word);
    });

    expect(result.current.progress.acceptedWords).toHaveLength(1);
    // Whatever stand-in today's system substitutes for an unmeasured word -- a
    // perfect 10 under the current system. A guess, and it belongs in the count.
    const standIn = rarityScore(unattestedZipf(), PUZZLE_DATE);
    expect(unattestedEvents()).toEqual([
      expect.objectContaining({ word, source: "curated", score: standIn }),
    ]);
  });

  it("stays silent for a curated word scored from real frequency data", async () => {
    const word = curatedWord(false);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(word);
    });

    expect(result.current.progress.acceptedWords).toHaveLength(1);
    expect(unattestedEvents()).toEqual([]);
  });

  it("records a live approval no frequency source attested, as live", async () => {
    expect(isValidWord(OFF_LIST_WORD)).toBe(false);
    stubValidate(null);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(unattestedEvents()).toEqual([
      expect.objectContaining({ word: OFF_LIST_WORD, source: "live" }),
    ]);
  });

  it("stays silent for a live approval that carried a frequency", async () => {
    stubValidate(3.0);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toHaveLength(1);
    expect(unattestedEvents()).toEqual([]);
  });

  it("fires once per word, not once per submission", async () => {
    // The count is the whole point of the event: a player re-submitting a word
    // they already banked must not inflate it.
    const word = curatedWord(true);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(word);
      await result.current.submitWord(word);
    });

    expect(result.current.progress.acceptedWords).toHaveLength(1);
    expect(unattestedEvents()).toHaveLength(1);
  });
});
