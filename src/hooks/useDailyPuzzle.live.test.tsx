import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { isValidWord } from "../game/dictionary";
import { resetLiveCheckSession } from "../game/liveValidate";
import { LIVE_CHECK_PENDING, LIVE_CHECK_SETTLED } from "./useDailyPuzzle";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

/** The payload of the one event named `name`, or undefined if it never fired. */
function eventPayload(name: string): Record<string, unknown> | undefined {
  const call = track.mock.calls.find(([event]) => event === name);
  return call?.[1] as Record<string, unknown> | undefined;
}

// A submission that clears every offline rule -- real letters, contains today's
// drop, not the drop itself -- but is not on the curated list, which is the only
// case that reaches the live fallback.
const DROP = dropForDate(todayDateString());
const OFF_LIST_WORD = `${DROP.toLowerCase()}qxz`;

/** Resolve /api/validate with `body`, optionally after a delay. */
function stubValidate(body: unknown, delayMs = 0) {
  const fetchMock = vi.fn(async () => {
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
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
    expect(result.current.feedback?.message).toContain("archaic");
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

  it("reports an approved word, its rarity, and that it counted", async () => {
    stubValidate(playable(3.0));
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(eventPayload("merriam_webster_approved")).toMatchObject({
      word: OFF_LIST_WORD,
      rarity: "Rare",
      zipf: 3,
      attested: true,
      applied: true,
      within_handoff: true,
    });
  });

  it("reports the failure reason when the lookup fails", async () => {
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

    expect(eventPayload("merriam_webster_failed")).toMatchObject({
      word: OFF_LIST_WORD,
      reason: "quota-exceeded",
      detail: "daily limit",
      status: 403,
    });
    // A failed lookup says nothing about the word, so nothing is approved.
    expect(eventPayload("merriam_webster_approved")).toBeUndefined();
  });

  it("reports a rejected word as neither approved nor a failure", async () => {
    stubValidate({
      word: OFF_LIST_WORD,
      outcome: "rejected",
      reason: "archaic",
      zipf: null,
      pos: ["adverb"],
      firstUse: null,
    });
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(eventPayload("merriam_webster_approved")).toBeUndefined();
    expect(eventPayload("merriam_webster_failed")).toBeUndefined();
  });

  it("still reports an approval that lands after the handoff", async () => {
    stubValidate(playable(3.0), 5400);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });
    expect(eventPayload("merriam_webster_approved")).toBeUndefined();

    await waitFor(
      () => {
        expect(eventPayload("merriam_webster_approved")).toBeDefined();
      },
      { timeout: 9000 },
    );
    expect(eventPayload("merriam_webster_approved")).toMatchObject({
      applied: true,
      within_handoff: false,
    });
  }, 15000);

  it("sends no event at all for an offline player", async () => {
    stubValidate(playable(3.0));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useDailyPuzzle());

    await act(async () => {
      await result.current.submitWord(OFF_LIST_WORD);
    });

    expect(eventPayload("merriam_webster_approved")).toBeUndefined();
    expect(eventPayload("merriam_webster_failed")).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("stops looking up words once the quota is spent, but reports it once", async () => {
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
    expect(eventPayload("merriam_webster_failed")).toBeDefined();

    // A second off-list word spends no request and does not re-report the
    // failure -- it was already reported when it was discovered.
    track.mockClear();
    await act(async () => {
      await result.current.submitWord(`${DROP.toLowerCase()}qxw`);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(eventPayload("merriam_webster_failed")).toBeUndefined();
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
    expect(result.current.feedback?.message).toContain(
      "doesn't contain the drop",
    );
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
