import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useDailyPuzzle } from "./hooks/useDailyPuzzle";
import { useSound } from "./hooks/useSound";
import { useYesterdaysBest, type ResolvedBest } from "./hooks/useYesterdaysBest";
import { markSeen } from "./game/whatsNew";
import { PLAYER_KEY } from "./game/player";
import { PROGRESS_PREFIX } from "./game/storage";
import { addDays } from "./game/date";
import { markBestWordNewsShown } from "./game/bestWordNews";

vi.mock("./hooks/useDailyPuzzle", () => ({ useDailyPuzzle: vi.fn() }));
vi.mock("./hooks/useSound", () => ({ useSound: vi.fn() }));
vi.mock("./hooks/useYesterdaysBest", () => ({ useYesterdaysBest: vi.fn() }));
vi.mock("./game/streakClimb", () => ({ checkStreakClimb: vi.fn(async () => null) }));

const TODAY = "2026-10-25";
const YESTERDAY = "2026-10-24";
const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function puzzle(overrides: Record<string, unknown> = {}) {
  return {
    date: TODAY,
    puzzleNumber: 1031,
    isToday: true,
    mode: "standard" as const,
    modeChosen: true,
    canGoToPrevious: true,
    canGoToNext: false,
    goToPrevious: vi.fn(),
    goToNext: vi.fn(),
    drop: "str",
    progress: { date: TODAY, drop: "str", acceptedWords: [], rejectedAttempts: [], completed: false },
    streak: { currentStreak: 0, longestStreak: 0, totalCompleted: 0, crushedIt: 0, elite: 0, highScore: 0 },
    feedback: null,
    submitWord: vi.fn(),
    canRetry: false,
    retryOffered: false,
    retrySpent: false,
    retryAnswer: vi.fn(),
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

function best(finderIds: string[]): ResolvedBest {
  return {
    day: YESTERDAY,
    best: { word: "quixotic", zipf: 1.2, finders: finderIds.length, rarity: "Mythic", foundOn: YESTERDAY, today: false },
    finderIds,
  };
}

/** `days` played days before today, each in Standard. */
function playedDays(days: number) {
  for (let i = 1; i <= days; i++) {
    const date = addDays(TODAY, -i);
    localStorage.setItem(
      PROGRESS_PREFIX + date,
      JSON.stringify({
        date,
        drop: "str",
        acceptedWords: [{ word: "string", rarity: "Common", zipf: 4 }],
        rejectedAttempts: [],
        completed: true,
      }),
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // In the header celebrations test's arm that sees them (see game/headerCelebrationsTest.ts).
  localStorage.setItem("ick:header-celebrations-test", "shown");
  markSeen("instructions");
  localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: SELF }));
  vi.mocked(useSound).mockReturnValue({
    accept: vi.fn(),
    reject: vi.fn(),
    complete: vi.fn(),
    jackpot: vi.fn(),
    applause: vi.fn(),
    rising: vi.fn(),
    achievement: vi.fn(),
  });
  vi.mocked(useDailyPuzzle).mockReturnValue(puzzle() as unknown as ReturnType<typeof useDailyPuzzle>);
});

describe("yesterday's best word news", () => {
  it("celebrates the finder on opening, once a day", () => {
    playedDays(3);
    vi.mocked(useYesterdaysBest).mockReturnValue(best([OTHER, SELF]));
    const { unmount } = render(<App />);
    expect(screen.getByText("You had yesterday's best word!")).toBeTruthy();
    unmount();

    render(<App />);
    expect(screen.queryByText("You had yesterday's best word!")).toBeNull();
  });

  it("keeps the finder's card from a player still on their first few words", () => {
    playedDays(2);
    vi.mocked(useYesterdaysBest).mockReturnValue(best([SELF]));
    render(<App />);
    expect(screen.queryByText("You had yesterday's best word!")).toBeNull();
  });

  it("tells another player who found it from their fourth day, once", () => {
    playedDays(4);
    vi.mocked(useYesterdaysBest).mockReturnValue(best([OTHER]));
    const { unmount } = render(<App />);
    expect(screen.getByText("Yesterday's best word")).toBeTruthy();
    unmount();

    render(<App />);
    expect(screen.queryByText("Yesterday's best word")).toBeNull();
  });

  it("never tells a player about somebody else's word once they have seen the card", () => {
    playedDays(4);
    markBestWordNewsShown(addDays(YESTERDAY, -2)); // their own best word, say, or somebody else's
    vi.mocked(useYesterdaysBest).mockReturnValue(best([OTHER]));
    render(<App />);
    expect(screen.queryByText("Yesterday's best word")).toBeNull();
  });

  it("still celebrates the finder after they have seen the card", () => {
    playedDays(4);
    markBestWordNewsShown(addDays(YESTERDAY, -2));
    vi.mocked(useYesterdaysBest).mockReturnValue(best([SELF]));
    render(<App />);
    expect(screen.getByText("You had yesterday's best word!")).toBeTruthy();
  });

  it("tells a newer player nothing", () => {
    playedDays(3);
    vi.mocked(useYesterdaysBest).mockReturnValue(best([OTHER]));
    render(<App />);
    expect(screen.queryByText("Yesterday's best word")).toBeNull();
  });

  it("gives way to the welcome-back card for another player's word", () => {
    playedDays(4);
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({
        // A streak that ended a while ago, which the welcome-back card greets.
        streak: {
          currentStreak: 0,
          longestStreak: 12,
          lastCompletedDate: addDays(TODAY, -10),
          totalCompleted: 12,
          crushedIt: 0,
          elite: 0,
          highScore: 0,
        },
      }) as unknown as ReturnType<typeof useDailyPuzzle>,
    );
    vi.mocked(useYesterdaysBest).mockReturnValue(best([OTHER]));
    render(<App />);
    expect(screen.getByText(/welcome back/i)).toBeTruthy();
    expect(screen.queryByText("Yesterday's best word")).toBeNull();
  });

  it("is not asked for on an archived puzzle", () => {
    vi.mocked(useDailyPuzzle).mockReturnValue(
      puzzle({ date: "2026-10-01", isToday: false }) as unknown as ReturnType<typeof useDailyPuzzle>,
    );
    vi.mocked(useYesterdaysBest).mockReturnValue(undefined);
    render(<App />);
    expect(vi.mocked(useYesterdaysBest).mock.calls.some(([day]) => day === undefined)).toBe(true);
  });
});
