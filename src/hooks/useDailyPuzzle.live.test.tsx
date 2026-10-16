import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { isValidWord } from "../game/dictionary";
import { REJECTION_MESSAGES } from "../game/submit";
import { resetLiveCheckSession } from "../game/liveValidate";
import { LIVE_CHECK_PENDING, LIVE_CHECK_SETTLED } from "./useDailyPuzzle";

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
vi.mock("@vercel/analytics", () => ({ track }));

// The puzzle's live fold rejections are read on every open; these tests count
// the Merriam-Webster requests, so that read is answered off the network.
vi.mock("../game/liveFoldRejections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/liveFoldRejections")>()),
  fetchLiveFoldRejections: vi.fn(async () => []),
}));

// A submission that clears every offline rule -- real letters, contains today's
// drop, not the drop itself -- but is not on the curated list, which is the only
// case that reaches the live fallback.
const DROP = dropForDate(todayDateString());
const OFF_LIST_WORD = `${DROP.toLowerCase()}qxz`;

/**
 * Resolve /api/validate with `body`, optionally after a delay.
 *
 * Every puzzle from the trial week on also fetches the word corpus on mount
 * (see consultsCorpus), and this date is one of them. Those requests are turned
 * away rather than served: the corpus would answer for `OFF_LIST_WORD` before
 * the live lookup ever ran, and this file is about the live lookup. A refused
 * fetch is the case loadCorpus is built to shrug off, so the game carries on
 * exactly as it did before the corpus existed -- which is the state these cases
 * want. The returned spy counts only the /api/validate calls, for the same
 * reason.
 */
function stubValidate(body: unknown, delayMs = 0) {
  const validate = vi.fn(async () => {
    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      status: 200,
      // Same-origin JSON, i.e. the request actually reached the function rather
      // than being intercepted (see the auth-redirect guard in liveValidate).
      url: `${location.origin}/api/validate`,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      String(url).startsWith("/corpus")
        ? Promise.resolve({ ok: false } as unknown as Response)
        : validate()
    )
  );
  return validate;
}

function playable(zipf: number | null) {
  return {
    word: OFF_LIST_WORD,
    outcome: "playable",
    reason: null,
    zipf,
    pos: ["noun"],
    firstUse: "1961",
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

describe("useDailyPuzzle live fallback", () => {
  it("only reaches the fallback for a word the offline data can't explain", () => {
    // Guards the premise of every test below.
    expect(isValidWord(OFF_LIST_WORD)).toBe(false);
    expect(OFF_LIST_WORD).toContain(DROP.toLowerCase());
  });

  it("banks a word Merriam-Webster approves inside the handoff window", async () => {
    stubValidate(playable(3.0));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toHaveLength(1);
    expect(result.current.progress.acceptedWords[0]).toMatchObject({
      word: OFF_LIST_WORD,
      // Scored from the frequency the lookup found, not the unattested floor.
      rarity: "Rare",
      zipf: 3.0,
    });
    expect(result.current.progress.rejectedAttempts).toEqual([]);
    expect(result.current.feedback?.kind).toBe("accepted");
    // Reads exactly like a curated word -- no mention of where the verdict came
    // from, identical to what an offline acceptance produces.
    expect(result.current.feedback?.message).toBe(
      `"${OFF_LIST_WORD}" accepted — Rare.`,
    );
  });

  it("falls back to the unattested floor when no frequency is found", async () => {
    stubValidate(playable(null));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    const accepted = result.current.progress.acceptedWords[0];
    expect(accepted.word).toBe(OFF_LIST_WORD);
    // The rarest tier -- the same treatment a curated word with no corpus data gets.
    expect(accepted.rarity).toBe("Legend");
  });

  it("says a check is running from the moment it starts", async () => {
    stubValidate(playable(3.0), 800);
    const { result } = renderHook(() => useDailyPuzzle());

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.submitWord(OFF_LIST_WORD);
      // Barely any time at all: the note is already up, so the wait is never
      // an unexplained pause.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(LIVE_CHECK_PENDING).toContain(result.current.liveNote);
    expect(result.current.feedback).toBeNull();

    await act(async () => {
      await pending;
    });

    // The note stays, but settles so the finished search reads as a completed
    // action rather than a message that just stops.
    expect(result.current.feedback?.kind).toBe("accepted");
    expect(result.current.liveNote).toBe(LIVE_CHECK_SETTLED.found);
  });

  it("moves through the rotation so two waits never read the same", async () => {
    // 800ms each, so the in-progress line is still up when it is read.
    stubValidate(playable(3.0), 800);
    const { result } = renderHook(() => useDailyPuzzle());

    const seen: Array<string | null> = [];
    for (const word of [OFF_LIST_WORD, `${DROP.toLowerCase()}qxw`]) {
      let pending: Promise<unknown> | undefined;
      await act(async () => {
        pending = result.current.submitWord(word);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      seen.push(result.current.liveNote);
      await act(async () => {
        await pending;
      });
    }

    expect(seen[0]).not.toBe(seen[1]);
    for (const line of seen) expect(LIVE_CHECK_PENDING).toContain(line);
  });

  it("carries no note for a submission that never needs a lookup", async () => {
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord("qqqqzz");
    });

    expect(result.current.liveNote).toBeNull();
  });

  it("clears the previous note when the next word is submitted", async () => {
    stubValidate(playable(3.0));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });
    expect(result.current.liveNote).toBe(LIVE_CHECK_SETTLED.found);

    await act(async () => {
      await result.current.submitWord("qqqqzz");
    });
    expect(result.current.liveNote).toBeNull();
  });

  it("rejects a word Merriam-Webster knows but the game shouldn't take", async () => {
    stubValidate({
      word: OFF_LIST_WORD,
      outcome: "rejected",
      reason: "archaic",
      zipf: null,
      pos: ["adverb"],
      firstUse: "12th century",
    });
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.progress.rejectedAttempts).toEqual([OFF_LIST_WORD]);
    // The specific reason MW supplied, not the generic curated-list message.
    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES.archaic);
    // A rejection is still a finished search: it settles on the empty-handed form.
    expect(result.current.liveNote).toBe(LIVE_CHECK_SETTLED.notFound);
  });

  it("keeps the offline rejection when the lookup itself fails", async () => {
    stubValidate({
      word: OFF_LIST_WORD,
      outcome: "error",
      reason: "quota-exceeded",
      detail: "daily limit",
      status: 403,
      zipf: null,
      pos: [],
      firstUse: null,
    });
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.progress.rejectedAttempts).toEqual([OFF_LIST_WORD]);
    expect(result.current.feedback?.kind).toBe("rejected");
  });

  it("stops blocking after the handoff window, then still banks a late approval", async () => {
    // Answers well after LIVE_HANDOFF_MS, so the player is released first.
    stubValidate(playable(3.0), 5400);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    // Released with a rejection showing, and nothing banked yet.
    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.feedback?.kind).toBe("rejected");

    // The request was never cancelled, so the approval still lands.
    await waitFor(
      () => {
        expect(result.current.progress.acceptedWords).toHaveLength(1);
      },
      { timeout: 9000 },
    );
    expect(result.current.progress.acceptedWords[0].word).toBe(OFF_LIST_WORD);
    // A late approval must not also leave the word recorded as a rejection.
    expect(result.current.progress.rejectedAttempts).toEqual([]);
    expect(result.current.feedback?.kind).toBe("accepted");
  }, 15000);

  it("stops looking up words once the quota is spent", async () => {
    const fetchMock = stubValidate({
      word: OFF_LIST_WORD,
      outcome: "error",
      reason: "quota-exceeded",
      detail: "daily limit",
      status: 403,
      zipf: null,
      pos: [],
      firstUse: null,
    });
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second off-list word spends no request.
    await act(async () => {
      await result.current.submitWord(`${DROP.toLowerCase()}qxw`);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The player still gets the ordinary rejection.
    expect(result.current.feedback?.kind).toBe("rejected");
  });

  it("makes no lookup for an offline player", async () => {
    const fetchMock = stubValidate(playable(3.0));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.progress.rejectedAttempts).toEqual([OFF_LIST_WORD]);
    vi.restoreAllMocks();
  });

  it("does not consult the fallback for a reason the offline data already knows", async () => {
    const fetchMock = stubValidate(playable(3.0));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      // Missing the drop is final -- MW has no say in the puzzle's own rules.
      await result.current.submitWord("qqqqzz");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.feedback?.message).toBe(REJECTION_MESSAGES["missing-drop"]);
  });

  it("banks a word only once when it is submitted twice mid-flight", async () => {
    // A short delay is enough: both submissions start before either resolves.
    stubValidate(playable(3.0), 50);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await Promise.all([
        result.current.submitWord(OFF_LIST_WORD),
        result.current.submitWord(OFF_LIST_WORD),
      ]);
    });

    await waitFor(
      () => {
        expect(result.current.progress.acceptedWords).toHaveLength(1);
      },
      { timeout: 9000 },
    );
  });
});
