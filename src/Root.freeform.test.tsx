import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "./Root";
import { FREEFORM_START } from "./game/dictionary";
import { FREEFORM_EXTENDED_START } from "./game/whatsNew";

/**
 * Root under a date inside the trial week, which is the only way to see the
 * announcement at all -- the header button and the sheet both hang off
 * `isFreeformWeek(todayDateString())`.
 *
 * Its own file rather than a case in Root.test.tsx, because pinning today's
 * date is not something that file's other tests should have to share: they are
 * about the player id and the history sync, and both read the calendar.
 *
 * Settable rather than fixed, because which badge is owed is a question about
 * the date: the cases below move the clock to the day the extension is
 * announced, and `beforeEach` puts it back at the start of the week.
 */
const clock = vi.hoisted(() => ({ today: "" }));
vi.mock("./game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game/date")>()),
  todayDateString: () => clock.today,
}));
vi.mock("./App", () => ({ default: () => <div>game</div> }));
vi.mock("./components/LeaderboardPage", () => ({
  LeaderboardPage: () => <div>leaderboard</div>,
}));
vi.mock("./components/FoundWordsPage", () => ({
  FoundWordsPage: () => <div>found words</div>,
}));
vi.mock("./components/SuggestedWordsPage", () => ({
  SuggestedWordsPage: () => <div>suggested words</div>,
}));
vi.mock("./components/FeedbackPage", () => ({
  FeedbackPage: () => <div>feedback</div>,
}));
vi.mock("./game/leaderboard", () => ({ syncHistory: vi.fn() }));
vi.mock("./analytics", () => ({
  trackLeaderboardJoined: vi.fn(),
  trackLeaderboardOpened: vi.fn(),
  trackFoundWordsOpened: vi.fn(),
  trackFreeformVote: vi.fn(),
  trackFreeformFeedback: vi.fn(),
  trackFeedbackSubmitted: vi.fn(),
}));

const sheet = () => screen.queryByRole("dialog", { name: /freeform week/i });
const howToPlay = () => screen.queryByRole("dialog", { name: /how to play/i });

describe("the Freeform week announcement", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clock.today = FREEFORM_START;
  });

  /** A stored puzzle with one accepted word, which is what "played" counts. */
  function playedPuzzle(date: string) {
    localStorage.setItem(
      `ick:progress:${date}`,
      JSON.stringify({
        date,
        drop: "INK",
        acceptedWords: [{ word: "think", rarity: "Common", zipf: 4.5 }],
      }),
    );
  }

  it("opens itself for a returning player, once the how-to-play sheet is out of the way", async () => {
    playedPuzzle("2026-09-10");
    render(<Root />);
    // The instructions come first, because they are the sheet that explains
    // what a score is, and two dialogs in one paint delivers neither.
    expect(howToPlay()).toBeInTheDocument();
    expect(sheet()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(howToPlay()).not.toBeInTheDocument();
    expect(sheet()).toBeInTheDocument();
  });

  it("leaves a first-timer alone", () => {
    // No puzzle behind them, so there is no sense of a word's worth for the
    // week to upend -- the sheet would stand between them and their first game.
    localStorage.setItem("ick:seen:instructions", "1");
    render(<Root />);
    expect(sheet()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /freeform week/i }),
    ).toBeInTheDocument();
  });

  it("reopens from the header button after it has been dismissed", async () => {
    localStorage.setItem("ick:seen:instructions", "1");
    playedPuzzle("2026-09-10");
    render(<Root />);
    expect(sheet()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(sheet()).not.toBeInTheDocument();

    // The button stays all week and opens the sheet again -- dismissing it
    // retires the *automatic* opening, not the way back to it.
    await userEvent.click(
      screen.getByRole("button", { name: /freeform week/i }),
    );
    expect(sheet()).toBeInTheDocument();
  });

  it("opens itself exactly once, ever", async () => {
    localStorage.setItem("ick:seen:instructions", "1");
    playedPuzzle("2026-09-10");

    const first = render(<Root />);
    expect(sheet()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    first.unmount();

    // A reload, a new tab, a visit on Thursday: all the same. Dismissing it is
    // permanent, and playing more puzzles does not earn it back.
    playedPuzzle("2026-09-11");
    render(<Root />);
    expect(sheet()).not.toBeInTheDocument();
  });

  it("keeps the badge up for a player who has not met the announcement", () => {
    localStorage.setItem("ick:seen:instructions", "1");
    render(<Root />);
    expect(screen.getByText(/scoring update/i)).not.toHaveClass(
      "app__freeform-badge--faded",
    );
  });

  it("retires the badge for good once the sheet has been closed", async () => {
    localStorage.setItem("ick:seen:instructions", "1");
    playedPuzzle("2026-09-10");
    const first = render(<Root />);
    expect(sheet()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.getByText(/scoring update/i)).toHaveClass(
      "app__freeform-badge--faded",
    );
    first.unmount();

    // The next session too: the badge points at news, and there is none left
    // for a player who has read it.
    render(<Root />);
    expect(screen.getByText(/scoring update/i)).toHaveClass(
      "app__freeform-badge--faded",
    );
  });

  it("retires the badge for good once its ten seconds are up", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("ick:seen:instructions", "1");
      const first = render(<Root />);
      expect(screen.getByText(/scoring update/i)).not.toHaveClass(
        "app__freeform-badge--faded",
      );

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText(/scoring update/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
      first.unmount();

      // Ten seconds in front of the player is the badge having had its chance,
      // and it does not get a second one tomorrow either.
      render(<Root />);
      expect(screen.getByText(/scoring update/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("still owes the sheet to a player whose badge only timed out", () => {
    vi.useFakeTimers();
    try {
      // A first-timer during the week: no puzzle behind them, so the sheet is
      // not offered yet and the badge is all they get.
      localStorage.setItem("ick:seen:instructions", "1");
      const first = render(<Root />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(sheet()).not.toBeInTheDocument();
      first.unmount();

      // Watching two words fade is not having read what changed. Once they have
      // a game behind them the sheet still opens itself, exactly once, as it
      // would have if the badge had never existed.
      playedPuzzle("2026-09-10");
      render(<Root />);
      expect(sheet()).toBeInTheDocument();
      // And the badge stays retired: it has had its moment either way.
      expect(screen.getByText(/scoring update/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retires the badge for good once it has been pressed", async () => {
    // A first-timer, so the sheet never opens itself: the press is the only
    // thing that has happened, and it is enough.
    localStorage.setItem("ick:seen:instructions", "1");
    const first = render(<Root />);
    await userEvent.click(screen.getByText(/scoring update/i));
    expect(sheet()).toBeInTheDocument();
    first.unmount();

    render(<Root />);
    expect(screen.getByText(/scoring update/i)).toHaveClass(
      "app__freeform-badge--faded",
    );
  });

  it("leaves the button itself alone once the badge is retired", () => {
    localStorage.setItem("ick:seen:instructions", "1");
    localStorage.setItem("ick:seen:freeform-badge", "1");
    render(<Root />);
    // The button is a label on the rules currently in force, not an unread
    // marker -- it stays all week for everybody.
    expect(
      screen.getByRole("button", { name: /freeform week/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/scoring update/i)).toHaveClass(
      "app__freeform-badge--faded",
    );
  });

  it("opens again if it was never dismissed", () => {
    // The stored flag is written on close, not on show, so a player who closed
    // the tab without reading it is still owed the one opening.
    localStorage.setItem("ick:seen:instructions", "1");
    playedPuzzle("2026-09-10");
    const first = render(<Root />);
    expect(sheet()).toBeInTheDocument();
    first.unmount();

    render(<Root />);
    expect(sheet()).toBeInTheDocument();
  });

  describe("and the extension announced partway through it", () => {
    beforeEach(() => {
      clock.today = FREEFORM_EXTENDED_START;
    });

    it("tells a player who already dismissed the first badge", () => {
      // The whole point of a second bit: the players who read "Scoring update"
      // and dismissed it are the ones most likely to care that the week is
      // running on, and a shared flag would hide it from exactly them.
      localStorage.setItem("ick:seen:instructions", "1");
      localStorage.setItem("ick:seen:freeform-badge", "1");
      render(<Root />);
      expect(screen.getByText(/freeform extended by 1 week/i)).not.toHaveClass(
        "app__freeform-badge--faded",
      );
    });

    it("says only the newer thing, never both at once", () => {
      localStorage.setItem("ick:seen:instructions", "1");
      render(<Root />);
      expect(screen.queryByText(/scoring update/i)).not.toBeInTheDocument();
    });

    it("retires for good once it has been pressed", async () => {
      localStorage.setItem("ick:seen:instructions", "1");
      localStorage.setItem("ick:seen:freeform-badge", "1");
      const first = render(<Root />);
      await userEvent.click(
        screen.getByText(/freeform extended by 1 week/i),
      );
      expect(sheet()).toBeInTheDocument();
      first.unmount();

      render(<Root />);
      expect(screen.getByText(/freeform extended by 1 week/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
    });

    it("retires for good once its ten seconds are up", () => {
      vi.useFakeTimers();
      try {
        localStorage.setItem("ick:seen:instructions", "1");
        const first = render(<Root />);
        act(() => {
          vi.advanceTimersByTime(10_000);
        });
        expect(screen.getByText(/freeform extended by 1 week/i)).toHaveClass(
          "app__freeform-badge--faded",
        );
        first.unmount();

        render(<Root />);
        expect(screen.getByText(/freeform extended by 1 week/i)).toHaveClass(
          "app__freeform-badge--faded",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("retires for good once the sheet has been closed", async () => {
      localStorage.setItem("ick:seen:instructions", "1");
      playedPuzzle("2026-09-10");
      const first = render(<Root />);
      expect(sheet()).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
      expect(screen.getByText(/freeform extended by 1 week/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
      first.unmount();

      render(<Root />);
      expect(screen.getByText(/freeform extended by 1 week/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
    });

    it("writes its own bit and only its own", () => {
      vi.useFakeTimers();
      try {
        localStorage.setItem("ick:seen:instructions", "1");
        render(<Root />);
        act(() => {
          vi.advanceTimersByTime(10_000);
        });

        // Each announcement keeps its own flag, so retiring one never counts
        // as having met the other -- in either direction.
        expect(localStorage.getItem("ick:seen:freeform-extended-badge")).toBe(
          "1",
        );
        expect(localStorage.getItem("ick:seen:freeform-badge")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
