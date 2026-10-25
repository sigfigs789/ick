import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { addDays } from "../game/date";
import { dropForDate } from "../game/drop";
import { isValidWord, topRarityScore, totalRarityScore } from "../game/dictionary";
import { joinBoard } from "../game/player";
import dictionaryWords from "../data/dictionary.json";

const track = vi.hoisted(() => vi.fn());
vi.mock("../eventLog", () => ({ logEvent: track }));

/**
 * A fixed puzzle to play, pinned rather than read off the clock.
 *
 * The retry is gated to puzzles from RETRY_START on (see game/constants), so a
 * suite that used the real today would fail before the start and pass after it
 * -- the same test telling two different stories depending on the day it ran.
 * Pinning also fixes the drop, which otherwise rotates daily underneath the
 * word lookups below.
 */
const TODAY = "2026-09-15";
const YESTERDAY = addDays(TODAY, -1);
const DROP = dropForDate(TODAY).toLowerCase();

/**
 * Words playable on a given drop, for banking and then retrying.
 *
 * An inflection of a word already picked is skipped: submitting it substitutes
 * the base form, which the puzzle has by then already banked, so the second
 * word never lands and the test is left with one answer where it wanted two.
 * The dictionary is alphabetical, so a word and its plural sit next to each
 * other -- "top" would otherwise hand back acetophenetidin and its -s.
 */
function playableWords(drop: string, count: number): string[] {
  const found: string[] = [];
  for (const word of dictionaryWords as unknown as string[]) {
    if (word === drop || !word.includes(drop) || !isValidWord(word)) continue;
    if (found.some((w) => word.startsWith(w) || w.startsWith(word))) continue;
    found.push(word);
    if (found.length === count) return found;
  }
  throw new Error(`only ${found.length} playable words for "${drop}"`);
}

const [FIRST, SECOND] = playableWords(DROP, 2);
const [YESTERDAYS_WORD] = playableWords(dropForDate(YESTERDAY).toLowerCase(), 1);

beforeEach(() => {
  localStorage.clear();
  track.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The day in the newest leaderboard submission the client posted. */
function lastSubmittedDay(
  fetchMock: ReturnType<typeof vi.fn>
): Record<string, unknown> | undefined {
  const bodies = fetchMock.mock.calls
    .filter(([url]) => String(url) === "/api/leaderboard")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
  const newest = bodies[bodies.length - 1];
  const scores = (newest?.scores ?? []) as Record<string, unknown>[];
  return scores[0];
}

describe("useDailyPuzzle retry", () => {
  it("offers nothing to retry until a word has been banked", () => {
    const { result } = renderHook(() => useDailyPuzzle());
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(false);
    // But the day's retry is still there to spend once a word lands -- the UI
    // shows the control (greyed out) from the moment the puzzle opens.
    expect(result.current.retryOffered).toBe(true);
  });

  it("drops the word, hands the guess back, and spends the retry", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    expect(result.current.canRetry).toBe(true);

    act(() => result.current.retryAnswer(FIRST));

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(true);

    // And the freed slot is spendable on something else.
    await act(async () => {
      await result.current.submitWord(SECOND);
    });
    expect(result.current.progress.acceptedWords.map((w) => w.word)).toEqual([SECOND]);
  });

  it("clears the verdict belonging to the word it dropped", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    expect(result.current.feedback).not.toBeNull();

    act(() => result.current.retryAnswer(FIRST));

    expect(result.current.feedback).toBeNull();
  });

  it("reports what was set aside, and where in the day it happened", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    await act(async () => {
      await result.current.submitWord(SECOND);
    });

    act(() => result.current.retryAnswer(FIRST));

    const [, payload] = track.mock.calls.find(([event]) => event === "answer_retried") ?? [];
    expect(payload).toMatchObject({
      puzzle_date: TODAY,
      word: FIRST,
      guess_index: 1,
      answer_count: 2,
    });
  });

  it("won't retry a word that isn't banked", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });

    act(() => result.current.retryAnswer(SECOND));

    expect(result.current.progress.acceptedWords.map((w) => w.word)).toEqual([FIRST]);
    // Nothing happened, so nothing was spent.
    expect(result.current.canRetry).toBe(true);
  });

  it("carries the retry into the archive, on any puzzle from the start on", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => result.current.goToPrevious());
    expect(result.current.isToday).toBe(false);
    // The allowance belongs to the puzzle, not to the day it is being played
    // on: yesterday dropped after RETRY_START, so it still has its retry.
    await act(async () => {
      await result.current.submitWord(YESTERDAYS_WORD);
    });
    expect(result.current.canRetry).toBe(true);

    act(() => result.current.retryAnswer(YESTERDAYS_WORD));

    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(result.current.retrySpent).toBe(true);
  });

  it("keeps each puzzle's retry its own", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    act(() => result.current.retryAnswer(FIRST));
    expect(result.current.retrySpent).toBe(true);

    // Spending today's does not reach back into yesterday's, which is still
    // sitting unspent on a puzzle of its own.
    act(() => result.current.goToPrevious());
    expect(result.current.retryOffered).toBe(true);
    expect(result.current.retrySpent).toBe(false);
  });

  it("stays spent when the player comes back to the puzzle", async () => {
    const first = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await first.result.current.submitWord(FIRST);
    });
    act(() => first.result.current.retryAnswer(FIRST));
    first.unmount();

    // A reload reads the same puzzle back out of storage.
    const { result } = renderHook(() => useDailyPuzzle());
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(true);
  });
});

describe("useDailyPuzzle reveal", () => {
  it("spends the retry and keeps the words, so the reveal can't be undone", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    const banked = result.current.progress.acceptedWords;

    act(() => result.current.revealAnswer());

    expect(result.current.progress.acceptedWords).toEqual(banked);
    expect(result.current.retryOffered).toBe(false);
    expect(result.current.retrySpent).toBe(true);
    // Nothing left to spend on a word afterwards.
    act(() => result.current.retryAnswer(FIRST));
    expect(result.current.progress.acceptedWords).toEqual(banked);
  });

  it("reports the reveal with the guesses standing behind it", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    await act(async () => {
      await result.current.submitWord(SECOND);
    });
    track.mockClear();

    act(() => result.current.revealAnswer());

    expect(track).toHaveBeenCalledWith(
      "answer_revealed",
      expect.objectContaining({ puzzle_date: TODAY, answer_count: 2 })
    );
  });

  it("spends an archive puzzle's retry the same way, and posts no board write", async () => {
    joinBoard();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDailyPuzzle());
    act(() => result.current.goToPrevious());
    await act(async () => {
      await result.current.submitWord(YESTERDAYS_WORD);
    });
    fetchMock.mockClear();

    act(() => result.current.revealAnswer());

    expect(result.current.progress.retryUsed).toBe(true);
    expect(result.current.retrySpent).toBe(true);
    // Nothing posted: the board takes today's puzzle only, so an archive day's
    // retry moves this browser's record and leaves the standings alone.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDailyPuzzle retry and the leaderboard", () => {
  it("corrects the board straight away rather than waiting for a replacement", async () => {
    joinBoard();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    await act(async () => {
      await result.current.submitWord(SECOND);
    });
    act(() => result.current.retryAnswer(FIRST));

    const correction = lastSubmittedDay(fetchMock);
    // Flagged, so the board's monotonic write is allowed to bring the day down
    // -- and sent now, so a player who takes a word back and then wanders off
    // is not left ranked on it.
    expect(correction).toMatchObject({ retried: true, words: 1 });
  });

  it("keeps the flag on every word banked after the retry", async () => {
    joinBoard();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    act(() => result.current.retryAnswer(FIRST));
    await act(async () => {
      await result.current.submitWord(SECOND);
    });

    const replacement = lastSubmittedDay(fetchMock);
    // Without this the replacement reads as a pre-retry straggler and is
    // dropped, leaving the corrected day stuck at its floor.
    expect(replacement).toMatchObject({ retried: true });
  });

  it("leaves the flag off a day that never spent its retry", async () => {
    joinBoard();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });

    expect(lastSubmittedDay(fetchMock)).not.toHaveProperty("retried");
  });
});

describe("useDailyPuzzle retry before the feature starts", () => {
  const BEFORE_START = "2026-09-01";

  beforeEach(() => {
    vi.setSystemTime(new Date(`${BEFORE_START}T12:00:00`));
  });

  it("offers no retry on a puzzle that dropped before the start", async () => {
    const [playable] = playableWords(dropForDate(BEFORE_START).toLowerCase(), 1);
    const { result } = renderHook(() => useDailyPuzzle());
    expect(result.current.date).toBe(BEFORE_START);
    await act(async () => {
      await result.current.submitWord(playable);
    });

    const banked = result.current.progress.acceptedWords;
    expect(banked).toHaveLength(1);
    // Today's puzzle, freshly played, and still no retry: the feature starts on
    // 2026-09-02 and a puzzle plays the way it did the day it dropped.
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(false);
    // Refused by the hook, not merely hidden by the UI.
    act(() => result.current.retryAnswer(banked[0].word));
    expect(result.current.progress.acceptedWords).toEqual(banked);
    expect(result.current.progress.retryUsed).toBeUndefined();
  });
});

describe("useDailyPuzzle retry allowance", () => {
  it("reports one retry from the moment the puzzle opens, then none", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    // Before any word: the allowance exists even though there is nothing to
    // spend it on yet.
    expect(result.current.retriesLeft).toBe(1);
    expect(result.current.canRetry).toBe(false);

    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    expect(result.current.retriesLeft).toBe(1);

    act(() => result.current.retryAnswer(FIRST));
    expect(result.current.retriesLeft).toBe(0);
  });

  it("reports one on an archive puzzle that dropped after the start", () => {
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => result.current.goToPrevious());
    // Yesterday is an archive puzzle now, but it dropped with a retry and keeps
    // it -- only the release date decides (see constants.retryAvailableFor).
    expect(result.current.retriesLeft).toBe(1);
  });
});

describe("useDailyPuzzle retry and the day's score", () => {
  it("drops the retried word out of the totals the player is shown", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    await act(async () => {
      await result.current.submitWord(SECOND);
    });
    const both = result.current.progress.acceptedWords;
    const totalBefore = totalRarityScore(both, TODAY);
    const survivor = both.find((w) => w.word === SECOND)!;

    act(() => result.current.retryAnswer(FIRST));

    const left = result.current.progress.acceptedWords;
    // The displayed total and top are read off the live word list, so both fall
    // out with the word rather than needing a rollback of their own: the day
    // now scores exactly as though only the surviving word was ever played.
    expect(left).toEqual([survivor]);
    expect(totalRarityScore(left, TODAY)).toBeLessThan(totalBefore);
    expect(totalRarityScore(left, TODAY)).toBe(totalRarityScore([survivor], TODAY));
    expect(topRarityScore(left, TODAY)).toBe(topRarityScore([survivor], TODAY));
  });

  it("sends no board correction when the retry empties the day", async () => {
    joinBoard();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(FIRST);
    });
    const before = fetchMock.mock.calls.length;

    act(() => result.current.retryAnswer(FIRST));

    // The documented residual: a day with no words is not submitted at all, so
    // the pre-retry row stands until the player banks something. Asserted so it
    // stays a known cost rather than becoming a surprise.
    expect(result.current.progress.acceptedWords).toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
