import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Copying a banked word into the other mode, end to end through the hook: the
 * word lands in the other mode's saved game, the switch does not move, and the
 * tap is reported as `answer_copied` rather than as a guess.
 *
 * Pinned to a date in the chosen era, where each mode keeps its own game.
 */
const DATE = "2026-10-01";
vi.mock("../game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/date")>()),
  todayDateString: () => DATE,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("../eventLog", () => ({ logEvent: track }));

const { useDailyPuzzle } = await import("./useDailyPuzzle");
const { dropForDate } = await import("../game/drop");
const { evaluateSubmission } = await import("../game/submit");
const { asMode, currentMode, resetModeCache, setMode } = await import("../game/mode");
const { loadProgressInMode } = await import("../game/crossMode");
const WORDS = (await import("../data/dictionary.json")).default as string[];

const DROP = dropForDate(DATE);

/** A day banked in `mode`, so the player counts as having played it. */
function seedPlayed(date: string, mode: "standard" | "freeform") {
  const key = `ick:progress:${date}${mode === "freeform" ? ":freeform" : ""}`;
  localStorage.setItem(key, JSON.stringify({ date, acceptedWords: [{ word: "seed" }] }));
}

/** A word for today's drop that both modes take but price differently. */
const WORD = WORDS.find((word) => {
  if (!word.includes(DROP.toLowerCase()) || word === DROP.toLowerCase()) return false;
  const standard = asMode("standard", () => evaluateSubmission(word, DROP, [], DATE));
  const freeform = asMode("freeform", () => evaluateSubmission(word, DROP, [], DATE));
  return standard.ok && freeform.ok && standard.word!.zipf !== freeform.word!.zipf;
})!;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetModeCache();
  setMode("standard");
  track.mockClear();
  // The offer is only for a player who has played both modes lately.
  seedPlayed("2026-09-30", "freeform");
});

function copyEvents() {
  return track.mock.calls.filter(([name]) => name === "answer_copied").map(([, props]) => props);
}

describe("copying a word into the other mode", () => {
  it("has a word to play with", () => {
    expect(WORD).toBeDefined();
  });

  it("banks the word in Freeform, at Freeform's price, without leaving Standard", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(WORD);
    });
    expect(result.current.otherMode).toBe("freeform");
    const preview = result.current.crossMode[WORD];
    expect(preview.state).toBe("ready");

    await act(async () => {
      await result.current.copyToOtherMode(WORD);
    });

    expect(currentMode()).toBe("standard");
    expect(result.current.mode).toBe("standard");
    expect(result.current.progress.acceptedWords.map((w) => w.word)).toEqual([WORD]);
    const freeform = loadProgressInMode(DATE, DROP, "freeform");
    expect(freeform.mode).toBe("freeform");
    expect(freeform.acceptedWords).toEqual([
      asMode("freeform", () => evaluateSubmission(WORD, DROP, [], DATE)).word,
    ]);
    expect(result.current.crossMode[WORD].state).toBe("copied");
    expect(result.current.feedback?.message).toContain("submitted to Freeform");

    const [event] = copyEvents();
    expect(event).toMatchObject({
      puzzle_date: DATE,
      live: true,
      from: "standard",
      to: "freeform",
      word: WORD,
      outcome: "copied",
      answer_count: 1,
    });
    expect(event.score_to).not.toBe(event.score_from);
    // A copy is not a guess.
    expect(track.mock.calls.filter(([name]) => name === "answer_accepted")).toHaveLength(1);
  });

  it("does nothing a second time once the word is over there", async () => {
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(WORD);
    });
    await act(async () => {
      await result.current.copyToOtherMode(WORD);
    });
    await act(async () => {
      await result.current.copyToOtherMode(WORD);
    });
    expect(loadProgressInMode(DATE, DROP, "freeform").acceptedWords).toHaveLength(1);
    expect(copyEvents()).toHaveLength(1);
  });

  it("offers nothing to a player who has only played this mode", async () => {
    localStorage.clear();
    const { result } = renderHook(() => useDailyPuzzle());
    await act(async () => {
      await result.current.submitWord(WORD);
    });
    expect(result.current.crossMode).toEqual({});
  });
});
