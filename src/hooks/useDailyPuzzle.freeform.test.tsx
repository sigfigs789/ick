import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FREEFORM_START } from "../game/dictionary";

/**
 * The live fallback under a date inside the trial week -- the one combination
 * `useDailyPuzzle.live.test.tsx` cannot cover, since that file plays on the real
 * today and the week is a fixed range in the calendar.
 *
 * Its own file rather than a case over there, because pinning today's date is
 * not something that file's other tests should have to share: they are about the
 * handoff window and the failure reporting, and both read the calendar.
 */
vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => FREEFORM_START,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("../eventLog", () => ({ logEvent: track }));

const { useDailyPuzzle } = await import("./useDailyPuzzle");
const { dropForDate } = await import("../game/drop");
const { isValidWord } = await import("../game/dictionary");
const { resetLiveCheckSession } = await import("../game/liveValidate");

const DROP = dropForDate(FREEFORM_START);
const OFF_LIST_WORD = `${DROP.toLowerCase()}qxz`;

/** Resolve /api/validate with `body`. */
function stubValidate(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          status: 200,
          url: `${location.origin}/api/validate`,
          redirected: false,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => body,
        }) as unknown as Response
    )
  );
}

/** A verdict Merriam-Webster refused for `reason`, carrying a real frequency. */
function rejected(reason: string, zipf: number | null = 2.4) {
  return {
    word: OFF_LIST_WORD,
    outcome: "rejected",
    reason,
    zipf,
    pos: ["noun"],
    firstUse: "1623",
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLiveCheckSession();
  track.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the live fallback during freeform week", () => {
  it("plays on a date inside the window, on a word only the fallback can answer", () => {
    // Guards the premise of every test below.
    expect(isValidWord(OFF_LIST_WORD)).toBe(false);
    expect(OFF_LIST_WORD).toContain(DROP.toLowerCase());
  });

  it.each([["archaic"], ["obsolete"], ["proper-noun"], ["abbreviation"], ["name-or-abbreviation"]])(
    "banks a word Merriam-Webster refused for being %s",
    async (reason) => {
      stubValidate(rejected(reason));
      const { result } = renderHook(() => useDailyPuzzle());

      await act(async () => {
        await result.current.submitWord(OFF_LIST_WORD);
      });

      expect(result.current.progress.acceptedWords).toHaveLength(1);
      expect(result.current.progress.rejectedAttempts).toEqual([]);
      expect(result.current.feedback?.kind).toBe("accepted");
    }
  );

  it("scores it on the frequency the lookup found, not the unattested floor", async () => {
    // The reason api/validate prices a rejected word at all. Without it every
    // waived word arrives with a null Zipf and takes a perfect 10.00, which
    // would say an ordinary obsolete word is as rare as one no corpus carries.
    stubValidate(rejected("obsolete", 2.4));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords[0]).toMatchObject({
      word: OFF_LIST_WORD,
      zipf: 2.4,
    });
  });

  it("says which rule it stood on, for the waivers about a word's age", async () => {
    stubValidate(rejected("archaic"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.feedback?.message).toMatch(/is archaic, but accepted/i);
  });

  it("says nothing extra for a waiver a player would not care about", async () => {
    // "Acronym, but accepted" is a category we filed it under, not a fact about
    // the word -- see NOTED_WAIVERS.
    stubValidate(rejected("abbreviation"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.feedback?.message).toMatch(/accepted/i);
    expect(result.current.feedback?.message).not.toMatch(/but accepted/i);
  });

  it("still refuses an offensive word, the one refusal the week keeps", async () => {
    stubValidate(rejected("offensive"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.feedback?.kind).toBe("rejected");
  });

  it("still refuses a word no reference carried", async () => {
    stubValidate({ word: OFF_LIST_WORD, outcome: "unknown", reason: null, zipf: null, pos: [], firstUse: null });
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.feedback?.kind).toBe("rejected");
  });
});
