import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { markSeen } from "./game/whatsNew";
import { addDays } from "./game/date";
import { checkStreakClimb } from "./game/streakClimb";
import { claimHeaderCelebration } from "./game/headerCelebrations";
import { checkTopRank } from "./game/topRank";

vi.mock("./hooks/useDailyPuzzle", () => ({ useDailyPuzzle: vi.fn() }));
vi.mock("./hooks/useSound", () => ({ useSound: vi.fn() }));
vi.mock("./game/streakClimb", () => ({ checkStreakClimb: vi.fn(async () => null) }));
vi.mock("./game/topRank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game/topRank")>()),
  checkTopRank: vi.fn(async () => null),
}));

const submitWord = vi.fn();
const retryAnswer = vi.fn();

/**
 * Words banked on `date`, as a player past their first few words has (see
 * game/headerCelebrations.ts, headerCelebrationsHeld).
 */
function bankWords(date: string, words: string[]) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({
      date,
      drop: "str",
      acceptedWords: words.map((word) => ({ word, rarity: "Common", zipf: 5 })),
      rejectedAttempts: [],
      completed: false,
      firstWordAt: `${date}T12:00:00`,
    })
  );
}

function puzzle(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-13",
    puzzleNumber: 958,
    isToday: true,
    // A puzzle from before the switch, so the calendar decides and the game is
    // the folding one -- which is what every case in this file is about.
    mode: "standard" as const,
    modeChosen: false,
    canGoToPrevious: true,
    canGoToNext: false,
    goToPrevious: vi.fn(),
    goToNext: vi.fn(),
    goToToday: vi.fn(),
    drop: "str",
    progress: {
      date: "2026-08-13",
      drop: "str",
      acceptedWords: [],
      rejectedAttempts: [],
      completed: false,
    },
    streak: { currentStreak: 0, longestStreak: 0, totalCompleted: 0, crushedIt: 0, elite: 0, highScore: 0 },
    feedback: null,
    submitWord,
    canRetry: false,
    retryOffered: false,
    retrySpent: false,
    retriesLeft: null,
    retryAnswer,
    revealAnswer: vi.fn(),
    resetAnswers: vi.fn(),
    otherMode: "freeform" as const,
    crossMode: {},
    copying: null,
    copyToOtherMode: vi.fn(),
    liveNote: null,
    checking: false,
    wordDataLoading: false,
    foldNotices: [],
    dismissFoldNotices: vi.fn(),
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // In the header celebrations test's arm that sees them (see game/headerCelebrationsTest.ts).
    localStorage.setItem("ick:header-celebrations-test", "shown");
    // Every test but the welcome one below is about the puzzle behind the
    // rules, so start them as a returning player who has already read them.
    markSeen("instructions");
    window.history.pushState(null, "", "/");
    vi.mocked(checkStreakClimb).mockResolvedValue(null);
    vi.mocked(checkTopRank).mockResolvedValue(null);
    vi.mocked(useSound).mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
      jackpot: vi.fn(),
      applause: vi.fn(),
      rising: vi.fn(),
      achievement: vi.fn(),
    });
  });

  it("submits a playable puzzle", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "strange");
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(submitWord).toHaveBeenCalledWith("strange");
  });

  it("notes an archived puzzle and offers Share from the first word", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({
        date: "2026-08-12",
        isToday: false,
        canGoToNext: true,
        progress: {
          date: "2026-08-12",
          drop: "str",
          acceptedWords: [{ word: "strange", rarity: "Common", zipf: 4.6 }],
          rejectedAttempts: [],
          completed: false,
        },
      }) as ReturnType<typeof useDailyPuzzle>
    );
    render(<App />);

    expect(screen.getByText(/playing an old puzzle/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /done guessing/i })).not.toBeInTheDocument();
  });

  it("keeps the share panel away until there is a word to share", () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    expect(screen.queryByRole("region", { name: /share result/i })).not.toBeInTheDocument();
  });

  it("replaces input controls with Share after completion", () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({
        progress: {
          date: "2026-08-13",
          drop: "str",
          acceptedWords: [{ word: "strange", rarity: "Common", zipf: 4.6 }],
          rejectedAttempts: [],
          completed: true,
        },
      }) as ReturnType<typeof useDailyPuzzle>
    );
    render(<App />);

    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lock in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  describe("an improving average", () => {
    const today = "2026-08-13";

    /** Three common days, then three rarer ones -- today's the last. */
    function storeRisingWeek() {
      [5, 5, 5, 3, 3, 3].forEach((zipf, i) => {
        const date = addDays(today, i - 5);
        localStorage.setItem(
          `ick:progress:${date}`,
          JSON.stringify({
            date,
            drop: "str",
            acceptedWords: [{ word: `w${i}`, rarity: "Common", zipf }],
            rejectedAttempts: [],
            completed: true,
            firstWordAt: `${date}T12:00:00`,
          })
        );
      });
    }

    function day(completed: boolean) {
      return puzzle({
        progress: {
          date: today,
          drop: "str",
          acceptedWords: [{ word: "w5", rarity: "Common", zipf: 3 }],
          rejectedAttempts: [],
          completed,
        },
      }) as ReturnType<typeof useDailyPuzzle>;
    }

    it("is celebrated on the guess that finishes today's puzzle", () => {
      storeRisingWeek();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(false));
      const { rerender } = render(<App />);
      expect(screen.queryByText("You're on the rise!")).not.toBeInTheDocument();

      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      rerender(<App />);
      expect(screen.getByText("You're on the rise!")).toBeInTheDocument();
      expect(vi.mocked(useSound).mock.results[0].value.rising).toHaveBeenCalledTimes(1);
    });

    it("is hidden from the header celebrations test's hidden arm", () => {
      storeRisingWeek();
      window.history.pushState(null, "", "/?header-celebrations=hidden");
      vi.mocked(useDailyPuzzle).mockReturnValue(day(false));
      const { rerender } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      rerender(<App />);
      expect(screen.queryByText("You're on the rise!")).not.toBeInTheDocument();
      expect(vi.mocked(useSound).mock.results[0].value.rising).not.toHaveBeenCalled();
    });

    it("gives way to a news card that already had today", () => {
      storeRisingWeek();
      claimHeaderCelebration("news", today); // yesterday's best word, say
      vi.mocked(useDailyPuzzle).mockReturnValue(day(false));
      const { rerender } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      rerender(<App />);
      expect(screen.queryByText("You're on the rise!")).not.toBeInTheDocument();
    });

    it("is not celebrated on a puzzle that mounts already finished", () => {
      storeRisingWeek();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      render(<App />);
      expect(screen.queryByText("You're on the rise!")).not.toBeInTheDocument();
    });
  });

  describe("a best day or week ever", () => {
    const today = "2026-08-13";
    const fourWords = (zipf: number) =>
      ["str1", "str2", "str3", "str4"].map((word) => ({ word, rarity: "Common", zipf }));

    function storeDay(date: string, zipf: number) {
      localStorage.setItem(
        `ick:progress:${date}`,
        JSON.stringify({
          date,
          drop: "str",
          acceptedWords: fourWords(zipf),
          rejectedAttempts: [],
          completed: true,
          firstWordAt: `${date}T12:00:00`,
        })
      );
    }

    function day(completed: boolean) {
      // At this date Zipf 2.5 four times is 31.20, past yesterday's 28.00 and
      // over the minimum.
      return puzzle({
        progress: {
          date: today,
          drop: "str",
          acceptedWords: fourWords(2.5),
          rejectedAttempts: [],
          completed,
          firstWordAt: `${today}T12:00:00`,
        },
      }) as ReturnType<typeof useDailyPuzzle>;
    }

    /** Mount today unfinished, closing the badges the old day welcomes, then finish. */
    function finish({ closeWelcome = true } = {}) {
      vi.mocked(useDailyPuzzle).mockReturnValue(day(false));
      const { rerender } = render(<App />);
      if (closeWelcome) {
        const dismiss = screen.queryByRole("button", { name: "Dismiss" });
        if (dismiss) act(() => dismiss.click());
      }
      // The finished day is in storage when the verdict lands.
      storeDay(today, 2.5);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      rerender(<App />);
    }

    beforeEach(() => {
      storeDay("2026-08-12", 3);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is celebrated on the finish that sets it", () => {
      finish();
      expect(screen.getByText("Your best day ever!")).toBeInTheDocument();
      expect(vi.mocked(useSound).mock.results[0].value.rising).toHaveBeenCalledTimes(1);
    });

    it("is not kept away by a news card earlier in the day", () => {
      claimHeaderCelebration("news", today); // yesterday's best word, say
      finish();
      expect(screen.getByText("Your best day ever!")).toBeInTheDocument();
    });

    it("keeps the top three away", async () => {
      vi.useFakeTimers();
      vi.mocked(checkTopRank).mockResolvedValue(1);
      finish();
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkTopRank).not.toHaveBeenCalled();
      expect(screen.queryByText("#1 today!")).not.toBeInTheDocument();
    });

    it("waits behind an achievement card, then shows", () => {
      finish({ closeWelcome: false });
      expect(screen.getByText(/achievements? unlocked/i)).toBeInTheDocument();
      expect(screen.queryByText("Your best day ever!")).not.toBeInTheDocument();
      act(() => screen.getByRole("button", { name: "Dismiss" }).click());
      expect(screen.getByText("Your best day ever!")).toBeInTheDocument();
    });

    it("is hidden from the header celebrations test's hidden arm", () => {
      window.history.pushState(null, "", "/?header-celebrations=hidden");
      finish();
      expect(screen.queryByText("Your best day ever!")).not.toBeInTheDocument();
    });

    it("is not celebrated on a puzzle that mounts already finished", () => {
      storeDay(today, 2.5);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      render(<App />);
      expect(screen.queryByText("Your best day ever!")).not.toBeInTheDocument();
    });
  });

  describe("a longest streak yet", () => {
    const today = "2026-08-13";
    const base = { totalCompleted: 9, crushedIt: 0, elite: 0, highScore: 0, bestToBeat: 9 };
    const before = { ...base, currentStreak: 9, longestStreak: 9, lastCompletedDate: "2026-08-12" };
    const after = { ...base, currentStreak: 10, longestStreak: 10, lastCompletedDate: today };

    it("is celebrated on the submission that passes the best", () => {
      bankWords("2026-08-12", ["strong", "strange", "street", "strap"]);
      vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ streak: before }) as ReturnType<typeof useDailyPuzzle>);
      const { rerender } = render(<App />);
      expect(screen.queryByText("Your longest streak yet!")).not.toBeInTheDocument();

      vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ streak: after }) as ReturnType<typeof useDailyPuzzle>);
      rerender(<App />);
      expect(screen.getByText("Your longest streak yet!").closest(".improvement__card")).toHaveTextContent(
        "10 days — past your best of 9."
      );
      expect(vi.mocked(useSound).mock.results[0].value.rising).toHaveBeenCalledTimes(1);
    });

    it("is kept from a new player who has yet to bank their fourth word", () => {
      bankWords("2026-08-12", ["strong", "strange", "street"]);
      vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ streak: before }) as ReturnType<typeof useDailyPuzzle>);
      const { rerender } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ streak: after }) as ReturnType<typeof useDailyPuzzle>);
      rerender(<App />);
      expect(screen.queryByText("Your longest streak yet!")).not.toBeInTheDocument();
      // Held back, it claims none of the day for the streak's other card.
      expect(localStorage.getItem("ick:headerCelebration:streak")).toBeNull();
    });

    it("is not thrown again on a reload that day", () => {
      vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ streak: after }) as ReturnType<typeof useDailyPuzzle>);
      render(<App />);
      expect(screen.queryByText("Your longest streak yet!")).not.toBeInTheDocument();
    });
  });

  describe("a climb up the streak board", () => {
    const today = "2026-08-13";
    const base = { totalCompleted: 9, crushedIt: 0, elite: 0, highScore: 0 };
    const before = { ...base, currentStreak: 5, longestStreak: 9, bestToBeat: 9, lastCompletedDate: "2026-08-12" };
    const up = { ...before, currentStreak: 6, lastCompletedDate: today };

    /** Today's puzzle with `words` banked and the streak as it stands. */
    function day(streak: object, words = 1, completed = false) {
      return puzzle({
        streak,
        progress: {
          date: today,
          drop: "str",
          acceptedWords: Array.from({ length: words }, (_, i) => ({ word: `str${i}`, rarity: "Common", zipf: 4.6 })),
          rejectedAttempts: [],
          completed,
        },
      }) as ReturnType<typeof useDailyPuzzle>;
    }

    beforeEach(() => {
      bankWords("2026-08-12", ["strong", "strange", "street", "strap"]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is celebrated a moment after today's first word takes the streak up", async () => {
      vi.useFakeTimers();
      vi.mocked(checkStreakClimb).mockResolvedValue({ from: 12, to: 9 });
      vi.mocked(useDailyPuzzle).mockReturnValue(day(before, 0));
      const { rerender } = render(<App />);

      vi.mocked(useDailyPuzzle).mockReturnValue(day(up));
      rerender(<App />);
      expect(checkStreakClimb).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkStreakClimb).toHaveBeenCalledWith(today);
      expect(screen.getByText("Up the streak board!")).toBeInTheDocument();
      expect(vi.mocked(useSound).mock.results[0].value.rising).toHaveBeenCalledTimes(1);
    });

    it("is not looked for on later words or the finish, when the streak stays put", async () => {
      vi.useFakeTimers();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(up, 1));
      const { rerender } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(up, 2));
      rerender(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(up, 4, true));
      rerender(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkStreakClimb).not.toHaveBeenCalled();
    });

    it("gives way to a longest streak yet on the same word", async () => {
      vi.useFakeTimers();
      vi.mocked(checkStreakClimb).mockResolvedValue({ from: 12, to: 9 });
      const tied = { ...base, currentStreak: 9, longestStreak: 9, bestToBeat: 9, lastCompletedDate: "2026-08-12" };
      const passed = { ...tied, currentStreak: 10, longestStreak: 10, lastCompletedDate: today };
      vi.mocked(useDailyPuzzle).mockReturnValue(day(tied, 0));
      const { rerender } = render(<App />);

      vi.mocked(useDailyPuzzle).mockReturnValue(day(passed));
      rerender(<App />);
      expect(screen.getByText("Your longest streak yet!")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkStreakClimb).toHaveBeenCalledWith(today);
      await act(() => vi.advanceTimersByTimeAsync(7000)); // the new best's card goes
      expect(screen.queryByText("Up the streak board!")).not.toBeInTheDocument();
    });

    it("is not looked for on a puzzle that mounts with the streak already up", async () => {
      vi.useFakeTimers();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(up));
      render(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkStreakClimb).not.toHaveBeenCalled();
    });
  });

  describe("a top-three place on the boards", () => {
    const today = "2026-08-13";
    /** Today's puzzle with `words` banked, finished or not. */
    function day(words: number, completed: boolean, extra: Record<string, unknown> = {}) {
      return puzzle({
        progress: {
          date: today,
          drop: "str",
          acceptedWords: Array.from({ length: words }, (_, i) => ({ word: `str${i}`, rarity: "Common", zipf: 4.6 })),
          rejectedAttempts: [],
          completed,
        },
        ...extra,
      }) as ReturnType<typeof useDailyPuzzle>;
    }

    /** Play to the finish: mounted unfinished, then finished. */
    async function finish(extra: Record<string, unknown> = {}) {
      vi.mocked(useDailyPuzzle).mockReturnValue(day(3, false, extra));
      const { rerender } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(4, true, extra));
      rerender(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      return rerender;
    }

    beforeEach(() => {
      bankWords("2026-08-12", ["strong", "strange", "street", "strap"]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is celebrated a moment after the puzzle is finished", async () => {
      vi.useFakeTimers();
      vi.mocked(checkTopRank).mockResolvedValue(2);
      await finish();
      expect(checkTopRank).toHaveBeenCalledWith(today);
      expect(screen.getByText("Top 3 today!")).toBeInTheDocument();
    });

    it("is looked for again when a retry's replacement word finishes the puzzle", async () => {
      vi.useFakeTimers();
      const rerender = await finish();
      expect(checkTopRank).toHaveBeenCalledTimes(1);
      vi.mocked(checkTopRank).mockResolvedValue(1);
      // The retry takes a word back and re-opens the puzzle...
      vi.mocked(useDailyPuzzle).mockReturnValue(day(3, false, { retrySpent: true }));
      rerender(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkTopRank).toHaveBeenCalledTimes(1);
      // ...and its replacement finishes it again.
      vi.mocked(useDailyPuzzle).mockReturnValue(day(4, true, { retrySpent: true }));
      rerender(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkTopRank).toHaveBeenCalledTimes(2);
      expect(screen.getByText("#1 today!")).toBeInTheDocument();
    });

    it("is not looked for on a word before the finish, or a puzzle that mounts finished", async () => {
      vi.useFakeTimers();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(1, false));
      const { rerender, unmount } = render(<App />);
      vi.mocked(useDailyPuzzle).mockReturnValue(day(2, false));
      rerender(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      unmount();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(4, true));
      render(<App />);
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(checkTopRank).not.toHaveBeenCalled();
    });

    it("is not kept away by a fold notice", async () => {
      vi.useFakeTimers();
      vi.mocked(checkTopRank).mockResolvedValue(3);
      await finish({ foldNotices: [{ word: "strings", base: "string", zipf: 3 }] });
      expect(screen.getByText("Top 3 today!")).toBeInTheDocument();
    });

    it("stays away on a day another header celebration had", async () => {
      vi.useFakeTimers();
      claimHeaderCelebration("streak", today);
      vi.mocked(checkTopRank).mockResolvedValue(1);
      await finish();
      expect(checkTopRank).not.toHaveBeenCalled();
      expect(screen.queryByText("#1 today!")).not.toBeInTheDocument();
    });

  });
});

describe("the results on a finished puzzle", () => {
  it("carries no leaderboard link -- the header's tab is the way there", () => {
    localStorage.clear();
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({
        progress: {
          date: "2026-08-13",
          drop: "str",
          acceptedWords: [{ word: "strange", rarity: "Common", zipf: 4.6 }],
          rejectedAttempts: [],
          completed: true,
        },
      }) as ReturnType<typeof useDailyPuzzle>
    );
    render(<App />);

    expect(screen.queryByRole("button", { name: "See the leaderboard" })).not.toBeInTheDocument();
  });
});

describe("the share panel", () => {
  const inPlay = {
    progress: {
      date: "2026-08-13",
      drop: "str",
      acceptedWords: [{ word: "strange", rarity: "Common", zipf: 4.6 }],
      rejectedAttempts: [],
      completed: false,
    },
  };

  beforeEach(() => {
    localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("stays hidden until the Share beside the guesses is pressed, then opens and scrolls to it", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle(inPlay) as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    expect(screen.queryByRole("region", { name: /share result/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("keeps the guess count and its Share on a finished puzzle, opening the panel the same way", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({ progress: { ...inPlay.progress, completed: true } }) as ReturnType<typeof useDailyPuzzle>,
    );
    render(<App />);
    expect(screen.getByText(/1 of \d+ guesses/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /share result/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^share$/i }));
    expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument();
  });
});

describe("the welcome-back card", () => {
  const lapsed = {
    currentStreak: 0,
    longestStreak: 12,
    lastCompletedDate: "2026-08-01",
    totalCompleted: 12,
    crushedIt: 0,
    elite: 0,
    highScore: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    markSeen("instructions");
    vi.mocked(useSound).mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
      jackpot: vi.fn(),
      applause: vi.fn(),
      rising: vi.fn(),
      achievement: vi.fn(),
    });
  });

  it("greets a player back after their streak ended, with the freeze on offer, until closed", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({ streak: lapsed }) as ReturnType<typeof useDailyPuzzle>
    );
    const { unmount } = render(<App />);

    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
    expect(screen.getByText(/streak freeze to cover a missed day/i)).toBeInTheDocument();

    const welcome = screen.getByText(/welcome back/i).closest<HTMLElement>(".welcome-back-card")!;
    await userEvent.click(within(welcome).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();

    // Closed for the day: a reload does not bring it back, but another day does.
    unmount();
    const second = render(<App />);
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    second.unmount();
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({ streak: lapsed, date: "2026-08-14" }) as ReturnType<typeof useDailyPuzzle>
    );
    render(<App />);
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it("is not shown on an archived puzzle, once a word is played, or to a player who never reached 3 days", () => {
    const cases = [
      puzzle({ streak: lapsed, isToday: false }),
      puzzle({
        streak: lapsed,
        progress: {
          date: "2026-08-13",
          drop: "str",
          acceptedWords: [{ word: "strange", rarity: "Common", zipf: 5 }],
          rejectedAttempts: [],
          completed: false,
        },
      }),
      puzzle({ streak: { ...lapsed, longestStreak: 2 } }),
    ];
    for (const value of cases) {
      vi.mocked(useDailyPuzzle).mockReturnValue(value as ReturnType<typeof useDailyPuzzle>);
      const { unmount } = render(<App />);
      expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
      unmount();
    }
  });
});


describe("celebrating a good word", () => {
  const jackpot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    markSeen("instructions");
    vi.mocked(useSound).mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
      jackpot,
      applause: vi.fn(),
      rising: vi.fn(),
      achievement: vi.fn(),
    });
  });

  it("throws confetti for every good word, and a jackpot for the top tiers", () => {
    const accepted = (key: number, rarity: string) => ({
      kind: "accepted",
      message: `accepted — ${rarity}.`,
      rarity,
      key,
    });
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: null }) as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    expect(document.querySelector(".confetti")).toBeNull();

    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1, "Common") }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(document.querySelector(".confetti")).toBeNull();

    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(2, "Rare") }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(document.querySelector(".confetti")).not.toBeNull();
    expect(document.querySelector(".confetti--grand")).toBeNull();

    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(3, "Legend") }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(document.querySelector(".confetti--grand")).not.toBeNull();
    expect(document.querySelector(".jackpot__stamp")).toHaveTextContent("Legend!");
    expect(jackpot).toHaveBeenCalledTimes(1);
  });
});

describe("celebrating an achievement", () => {
  const achievement = vi.fn();
  const accepted = (key: number) => ({ kind: "accepted", message: "accepted — Common.", rarity: "Common", key });
  const bank = (date: string, word: string) => bankWords(date, [word]);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("ick:header-celebrations-test", "shown");
    markSeen("instructions");
    vi.mocked(useSound).mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
      jackpot: vi.fn(),
      applause: vi.fn(),
      rising: vi.fn(),
      achievement,
    });
  });

  it("holds a new player's badges until their fourth banked word, then announces them with its fanfare", () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();

    // The first word earns X marks the spot, but the card waits.
    bankWords("2026-08-13", ["strix"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    bankWords("2026-08-13", ["strix", "strong"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(2) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    bankWords("2026-08-13", ["strix", "strong", "street"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(3) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
    expect(achievement).not.toHaveBeenCalled();

    bankWords("2026-08-13", ["strix", "strong", "street", "strap"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(4) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.getByText("Achievement unlocked")).toBeInTheDocument();
    expect(screen.getByText("X marks the spot")).toBeInTheDocument();
    expect(achievement).toHaveBeenCalledTimes(1);

    // Gone on a tap of its ×, and not announced again by the next word.
    const card = screen.getByText("X marks the spot").closest<HTMLElement>(".improvement__card")!;
    act(() => within(card).getByRole("button", { name: "Dismiss" }).click());
    expect(screen.queryByText("X marks the spot")).toBeNull();
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(5) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
  });

  it("still names a held badge on the fourth word after a reload", () => {
    bankWords("2026-08-13", ["strix", "strong", "street"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    expect(screen.queryByText(/achievements? unlocked/i)).toBeNull();

    bankWords("2026-08-13", ["strix", "strong", "street", "strap"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.getByText("X marks the spot")).toBeInTheDocument();
  });

  it("never announces a badge already announced, as the page opened or after", () => {
    bankWords("2026-08-12", ["strong", "strix", "street", "strap"]);
    localStorage.setItem("ick:achievements-announced", JSON.stringify(["x-word"]));
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
  });

  it("welcomes a returning player's unannounced badges once, naming the best three", () => {
    const words = ["strong", "strange", "street", "strap", "strict", "string", "strive", "stroke", "struck", "strum"];
    words.forEach((word, i) => bank(`2026-08-${String(i + 1).padStart(2, "0")}`, word));
    localStorage.setItem(
      "ick:progress:2026-08-11",
      JSON.stringify({
        date: "2026-08-11",
        drop: "str",
        acceptedWords: [{ word: "strobilation", rarity: "Legend", zipf: 1 }],
        rejectedAttempts: [],
        completed: false,
        firstWordAt: "2026-08-11T12:00:00",
      })
    );
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { unmount } = render(<App />);
    const earned = JSON.parse(localStorage.getItem("ick:achievements-announced")!) as string[];
    expect(earned.length).toBeGreaterThan(3);
    expect(screen.getByText(`${earned.length} achievements unlocked`)).toBeInTheDocument();
    // The rarest first, and only three by name.
    expect(screen.getByText("Living legend")).toBeInTheDocument();
    expect(document.querySelectorAll(".achievement-unlocked__item")).toHaveLength(3);
    expect(
      screen.getByText(`And ${earned.length - 3} more. See them all on your Stats page.`)
    ).toBeInTheDocument();
    expect(achievement).toHaveBeenCalledTimes(1);

    // Once: the next open has nothing to welcome.
    unmount();
    render(<App />);
    expect(screen.queryByText(/achievements? unlocked/i)).toBeNull();
  });

  it("keeps the welcome from the players the header celebrations test hides the cards from", () => {
    localStorage.setItem("ick:header-celebrations-test", "hidden");
    bankWords("2026-08-12", ["strong", "strix", "street", "strap"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
    expect(localStorage.getItem("ick:achievements-announced")).toBeNull();
  });

  it("stays away from the players the header celebrations test hides the cards from", () => {
    localStorage.setItem("ick:header-celebrations-test", "hidden");
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    bankWords("2026-08-13", ["strix", "strong", "street", "strap"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.queryByText("Achievement unlocked")).toBeNull();
    expect(achievement).not.toHaveBeenCalled();
  });

  it("shows to a player not yet drawn into that test, without drawing them", () => {
    localStorage.removeItem("ick:header-celebrations-test");
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { rerender } = render(<App />);
    bankWords("2026-08-13", ["strix", "strong", "street", "strap"]);
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle({ feedback: accepted(1) }) as ReturnType<typeof useDailyPuzzle>);
    rerender(<App />);
    expect(screen.getByText("X marks the spot")).toBeInTheDocument();
    expect(localStorage.getItem("ick:header-celebrations-test")).toBeNull();
  });
});
