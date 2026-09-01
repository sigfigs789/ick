import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { isValidWord } from "../game/dictionary";
import dictionaryWords from "../data/dictionary.json";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

const TODAY = todayDateString();
const YESTERDAY = addDays(TODAY, -1);
const DROP = dropForDate(TODAY).toLowerCase();

/** Words playable on a given drop, for banking and then retrying. */
function playableWords(drop: string, count: number): string[] {
  const found: string[] = [];
  for (const word of dictionaryWords as unknown as string[]) {
    if (word === drop || !word.includes(drop) || !isValidWord(word)) continue;
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
});

describe("useDailyPuzzle retry", () => {
  it("offers nothing to retry until a word has been banked", () => {
    const { result } = renderHook(() => useDailyPuzzle());
    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(false);
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

  it("keeps the retry off an archive puzzle, however freshly it was played", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    act(() => result.current.goToPrevious());
    expect(result.current.isToday).toBe(false);
    // Played right now, on a puzzle that is no longer the current one -- which
    // is the boundary: the retry belongs to the puzzle, not to the session.
    await act(async () => {
      await result.current.submitWord(YESTERDAYS_WORD);
    });
    const banked = result.current.progress.acceptedWords;
    expect(banked).toHaveLength(1);

    expect(result.current.canRetry).toBe(false);
    expect(result.current.retrySpent).toBe(false);
    // Not merely hidden -- the hook refuses it, so a stale button can't reach it.
    act(() => result.current.retryAnswer(banked[0].word));
    expect(result.current.progress.acceptedWords).toEqual(banked);
    expect(result.current.progress.retryUsed).toBeUndefined();
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
