import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { markSeen } from "./game/whatsNew";
import { setUiVariantForTest } from "./game/uiVariant";
import { addDays } from "./game/date";

vi.mock("./hooks/useDailyPuzzle", () => ({ useDailyPuzzle: vi.fn() }));
vi.mock("./hooks/useSound", () => ({ useSound: vi.fn() }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/react", () => ({ SpeedInsights: () => null }));

const submitWord = vi.fn();
const retryAnswer = vi.fn();

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
    foldNotices: [],
    dismissFoldNotices: vi.fn(),
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Every test but the welcome one below is about the puzzle behind the
    // rules, so start them as a returning player who has already read them.
    markSeen("instructions");
    window.history.pushState(null, "", "/");
    vi.mocked(useSound).mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
      applause: vi.fn(),
      rising: vi.fn(),
    });
  });

  it("submits a playable puzzle", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "strange");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(submitWord).toHaveBeenCalledWith("strange");
  });

  it("notes an archived puzzle and offers the share panel from the first word", async () => {
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
    expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /done guessing/i })).not.toBeInTheDocument();
  });

  it("keeps the share panel away until there is a word to share", () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    expect(screen.queryByRole("region", { name: /share result/i })).not.toBeInTheDocument();
  });

  it("replaces input controls with sharing results after completion", () => {
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

    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lock in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument();
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

    it("is not celebrated on a puzzle that mounts already finished", () => {
      storeRisingWeek();
      vi.mocked(useDailyPuzzle).mockReturnValue(day(true));
      render(<App />);
      expect(screen.queryByText("You're on the rise!")).not.toBeInTheDocument();
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

describe("the new play screen's share panel", () => {
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
    setUiVariantForTest("v2");
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => setUiVariantForTest("control"));

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
