import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { markSeen } from "./game/whatsNew";
import { setUiVariantForTest } from "./game/uiVariant";

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
      jackpot: vi.fn(),
      applause: vi.fn(),
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
