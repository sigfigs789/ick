import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";

vi.mock("./hooks/useDailyPuzzle", () => ({ useDailyPuzzle: vi.fn() }));
vi.mock("./hooks/useSound", () => ({ useSound: vi.fn() }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/react", () => ({ SpeedInsights: () => null }));

const submitWord = vi.fn();
const lockIn = vi.fn();

function puzzle(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-13",
    puzzleNumber: 958,
    isToday: true,
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
    lockIn,
    resetAnswers: vi.fn(),
    liveNote: null,
    checking: false,
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.pushState(null, "", "/");
    vi.mocked(useSound).mockReturnValue({
      enabled: true,
      toggle: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
      complete: vi.fn(),
    });
  });

  it("opens the instructions and submits a playable puzzle", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "strange");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(submitWord).toHaveBeenCalledWith("strange");
  });

  it("shows archive and lock-in controls only for an unfinished archived puzzle with a word", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /i'm done guessing/i }));
    expect(lockIn).toHaveBeenCalledTimes(1);
  });

  it("badges the leaderboard until it has been visited, then never again", async () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    const { unmount } = render(<App />);

    // The badge is part of the button's accessible name, so a screen reader
    // hears the announcement rather than only seeing it.
    await userEvent.click(screen.getByRole("button", { name: "Leaderboard (new)" }));
    // A real page at a real URL, not a modal over the puzzle.
    expect(window.location.pathname).toBe("/leaderboard");
    expect(screen.getByRole("button", { name: "Leaderboard" })).toBeInTheDocument();

    // And it stays gone across a reload, which is what "once" has to mean.
    unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Leaderboard" })).toBeInTheDocument();
  });

  it("does not badge the leaderboard for a player who has already met it", () => {
    localStorage.setItem("ick:seen:leaderboard", "1");
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    expect(screen.getByRole("button", { name: "Leaderboard" })).toBeInTheDocument();
    expect(screen.queryByText("new")).not.toBeInTheDocument();
  });

  it("retires the badge when the leaderboard is reached from the results instead", async () => {
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

    expect(screen.getByRole("button", { name: "Leaderboard (new)" })).toBeInTheDocument();
    // Either entry point counts as meeting it -- the badge says "there is
    // something here you haven't seen", and now they have.
    await userEvent.click(screen.getByRole("button", { name: "See the leaderboard" }));
    expect(window.location.pathname).toBe("/leaderboard");
    expect(screen.getByRole("button", { name: "Leaderboard" })).toBeInTheDocument();
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

describe("the leaderboard trophy", () => {
  it("is always there", () => {
    // It was briefly hidden until the leaderboard had something to show, which
    // deadlocked the cold start: finds only exist once players join, and joining
    // is only reachable through this button.
    localStorage.clear();
    vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as ReturnType<typeof useDailyPuzzle>);
    render(<App />);

    expect(screen.getByRole("button", { name: "Leaderboard (new)" })).toBeInTheDocument();
  });

  it("offers the results link on a finished puzzle", () => {
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

    expect(screen.getByRole("button", { name: "See the leaderboard" })).toBeInTheDocument();
  });
});
