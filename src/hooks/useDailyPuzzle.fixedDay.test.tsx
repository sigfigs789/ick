/**
 * The puzzle a fixed day puts you on, and what you can still reach from it.
 *
 * The Reddit build fixes the day to the post's own puzzle (see
 * devvit/src/server/core/puzzle.ts). This checks that fixing it changes the
 * anchor and nothing else: the game is the same game, with the same archive
 * behind it, wound to a different day.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDailyPuzzle } from "./useDailyPuzzle";
import { addDays, setPuzzleDay, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import dropData from "../data/drops.json";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

/** A day well after the epoch, so there is archive on both sides of it. */
const POST_DAY = "2026-08-12";

afterEach(() => {
  setPuzzleDay(null);
  localStorage.clear();
});

describe("a day fixed by the host", () => {
  it("puts the player on that puzzle, not the clock's", () => {
    setPuzzleDay(POST_DAY);
    const { result } = renderHook(() => useDailyPuzzle());

    expect(result.current.date).toBe(POST_DAY);
    expect(result.current.drop).toBe(dropForDate(POST_DAY));
    // And it is "today" for everything that asks -- the streak, the progress
    // key, the board windows all read the same day the drop came from.
    expect(result.current.isToday).toBe(true);
    expect(todayDateString()).toBe(POST_DAY);
  });

  it("keeps the archive, walking back from the fixed day", () => {
    setPuzzleDay(POST_DAY);
    const { result } = renderHook(() => useDailyPuzzle());

    expect(result.current.canGoToPrevious).toBe(true);
    act(() => result.current.goToPrevious());

    expect(result.current.date).toBe(addDays(POST_DAY, -1));
    expect(result.current.drop).toBe(dropForDate(addDays(POST_DAY, -1)));
    // Off the board and off the streak, exactly as archive play is on the site.
    expect(result.current.isToday).toBe(false);
  });

  it("comes forward again to the fixed day and stops there", () => {
    setPuzzleDay(POST_DAY);
    const { result } = renderHook(() => useDailyPuzzle());

    act(() => result.current.goToPrevious());
    expect(result.current.canGoToNext).toBe(true);
    act(() => result.current.goToNext());

    expect(result.current.date).toBe(POST_DAY);
    // Nothing past the day being played, which on a post is the post's own
    // puzzle: the next one has a post of its own.
    expect(result.current.canGoToNext).toBe(false);
  });

  it("still stops at the first puzzle there has ever been", () => {
    setPuzzleDay(dropData.epoch);
    const { result } = renderHook(() => useDailyPuzzle());
    expect(result.current.canGoToPrevious).toBe(false);
  });
});
