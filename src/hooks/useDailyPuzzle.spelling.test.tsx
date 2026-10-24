import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { isValidWord } from "../game/dictionary";
import { resetLiveCheckSession } from "../game/liveValidate";
import { evaluateSubmission, REJECTION_MESSAGES, spellingNearMiss } from "../game/submit";
import dictionaryWords from "../data/dictionary.json";

/**
 * Pinned to the first ordinary puzzle after the freeform trial.
 *
 * These cases are about the rule that holds the rest of the time -- a word a
 * reference found and the game still will not take. Freeform week waives exactly
 * those refusals (see waivedLiveRejection), so on a date inside the window there
 * is no refusal left to assert, and the file would be testing the calendar
 * rather than the rule. The week's own behaviour has its own file:
 * useDailyPuzzle.freeform.test.tsx.
 */
vi.mock("../game/date", async (importOriginal) => {
  // The first puzzle back on the folding system, taken off the constant rather
  // than written out: the trial has been extended once already, and a literal
  // date here would have quietly moved inside the window when it was.
  const { FREEFORM_END } = await import("../game/dictionary");
  return {
    ...(await importOriginal<typeof import("../game/date")>()),
    todayDateString: () => FREEFORM_END,
  };
});

const track = vi.hoisted(() => vi.fn());
vi.mock("../eventLog", () => ({ logEvent: track }));

const DROP = dropForDate(todayDateString()).toLowerCase();

/**
 * A guess for today's drop that clears every offline rule, is found nowhere, and
 * sits one letter from a word that *is* playable. Built from the dictionary
 * rather than hard-coded, because the drop rotates daily.
 */
function nearMissGuess(): string {
  for (const word of dictionaryWords as unknown as string[]) {
    if (word.length < 7 || !word.includes(DROP) || !isValidWord(word)) continue;
    for (let i = 0; i < word.length; i++) {
      for (const letter of "qxzj") {
        const typo = `${word.slice(0, i)}${letter}${word.slice(i + 1)}`;
        // "not-a-word" specifically: a typo the offline data can explain some
        // other way (a known misspelling, say) never reaches the nudge.
        if (evaluateSubmission(typo, DROP, []).reason !== "not-a-word") continue;
        if (spellingNearMiss(typo, DROP, [])) return typo;
      }
    }
  }
  throw new Error(`no near-miss guess for "${DROP}"`);
}

const NEAR_MISS = nearMissGuess();
/** A guess for the same drop that isn't close to anything. */
const FAR_OFF = `${DROP}qxzjvbnmk`;

/** Resolve /api/validate with `body`. */
function stubValidate(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      url: `${location.origin}/api/validate`,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    })) as unknown as typeof fetch
  );
}

function verdict(word: string, outcome: string, reason: string | null = null) {
  return { word, outcome, reason, zipf: null, pos: [], firstUse: null };
}

/** The `rejection_message_shown` reasons fired so far, in order. */
function reasonsShown(): unknown[] {
  return track.mock.calls
    .filter(([event]) => event === "rejection_message_shown")
    .map(([, payload]) => (payload as Record<string, unknown>).rejection_reason);
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

describe("useDailyPuzzle spelling nudge", () => {
  it("uses guesses that are, and aren't, near misses", () => {
    // Guards the premise of every test below: both guesses clear every offline
    // rule and reach the live fallback, and only one of them is close to a word.
    expect(evaluateSubmission(NEAR_MISS, DROP, []).reason).toBe("not-a-word");
    expect(evaluateSubmission(FAR_OFF, DROP, []).reason).toBe("not-a-word");
    expect(spellingNearMiss(NEAR_MISS, DROP, [])).toBeDefined();
    expect(spellingNearMiss(FAR_OFF, DROP, [])).toBeUndefined();
  });

  it("asks the player to check their spelling once the search comes up empty", async () => {
    stubValidate(verdict(NEAR_MISS, "unknown"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(NEAR_MISS);
    });

    expect(result.current.feedback?.kind).toBe("rejected");
    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["check-your-spelling"]);
    expect(reasonsShown()).toEqual(["check-your-spelling"]);
    // Still a rejection in every other respect.
    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.progress.rejectedAttempts).toEqual([NEAR_MISS]);
  });

  it("keeps the plain not-found message for a guess that isn't close to anything", async () => {
    stubValidate(verdict(FAR_OFF, "unknown"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(FAR_OFF);
    });

    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["not-a-word"]);
    expect(reasonsShown()).toEqual(["not-a-word"]);
  });

  it("nudges when the lookup itself failed, since the word is still unfound", async () => {
    stubValidate(verdict(NEAR_MISS, "error", "upstream-timeout"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(NEAR_MISS);
    });

    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["check-your-spelling"]);
  });

  it("does not nudge when a reference found the word and the game still won't take it", async () => {
    // Obsolete rather than a proper noun: from MODE_CHOICE_START names and
    // abbreviations are playable in both modes, so a proper-noun verdict is a
    // word being *accepted* here and would test nothing. The age trio is what
    // is still refused on a word spelled exactly as it was meant.
    stubValidate(verdict(NEAR_MISS, "rejected", "obsolete"));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(NEAR_MISS);
    });

    // Spelled exactly as meant -- there is no typo to go looking for.
    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["obsolete"]);
    expect(reasonsShown()).toEqual(["obsolete"]);
  });

  it("leaves every other rejection alone", async () => {
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord("zzzz");
    });

    // "zzzz" contains no drop in the rotation, whatever today's is.
    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["missing-drop"]);
  });
});
