import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "./Root";
import { FREEFORM_START } from "./game/dictionary";
import { MODE_CHOICE_START } from "./game/mode";

/**
 * Root under a pinned date, which is the only way to see either of the two
 * things this file is about: the trial week's sheet, which hangs off
 * `usesFreeformRules(todayDateString())`, and the mode switch and its badge,
 * which hang off `modeIsChosen(todayDateString())`. The two never overlap --
 * the trial's last day is the day before the switch appears.
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
  trackModeChanged: vi.fn(),
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

  it("puts no switch on the header while the calendar is still deciding", () => {
    localStorage.setItem("ick:seen:instructions", "1");
    render(<Root />);
    // Inside the trial everybody is on the same rules, so a control offering a
    // choice would be offering one nobody has -- and a badge pointing at it
    // would be marking the "?" as new.
    expect(
      screen.queryByRole("button", { name: /switch to/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/change mode/i)).not.toBeInTheDocument();
  });
});

describe("the mode switch, from the choice date on", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clock.today = MODE_CHOICE_START;
    localStorage.setItem("ick:seen:instructions", "1");
  });

  const modeButton = () => screen.getByRole("button", { name: /switch to/i });

  it("opens on Standard for a player who has never chosen", () => {
    render(<Root />);
    expect(modeButton()).toHaveTextContent("Standard");
  });

  it("remembers the choice, in this session and the next", async () => {
    const first = render(<Root />);
    await userEvent.click(modeButton());
    expect(modeButton()).toHaveTextContent("Freeform");
    first.unmount();

    // A mode is a setting, not a session: a player who switched on Monday is
    // still in Freeform on Tuesday without being asked again.
    render(<Root />);
    expect(modeButton()).toHaveTextContent("Freeform");
  });

  it("keeps the badge up for a player who has not met it", () => {
    render(<Root />);
    expect(screen.getByText(/change mode/i)).not.toHaveClass(
      "app__mode-badge--faded",
    );
  });

  it("retires the badge for good once the switch has been used", async () => {
    const first = render(<Root />);
    await userEvent.click(modeButton());
    expect(screen.getByText(/change mode/i)).toHaveClass(
      "app__mode-badge--faded",
    );
    first.unmount();

    // The badge exists to point at a control nobody has seen. A player who has
    // used it has seen it, and does not need telling again tomorrow.
    render(<Root />);
    expect(screen.getByText(/change mode/i)).toHaveClass(
      "app__mode-badge--faded",
    );
  });

  it("retires the badge for good once its ten seconds are up", () => {
    vi.useFakeTimers();
    try {
      const first = render(<Root />);
      expect(screen.getByText(/change mode/i)).not.toHaveClass(
        "app__mode-badge--faded",
      );

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText(/change mode/i)).toHaveClass(
        "app__mode-badge--faded",
      );
      first.unmount();

      // Ten seconds in front of the player is the badge having had its chance,
      // and it does not get a second one tomorrow either.
      render(<Root />);
      expect(screen.getByText(/change mode/i)).toHaveClass(
        "app__mode-badge--faded",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the switch itself alone once the badge is retired", () => {
    localStorage.setItem("ick:seen:mode-toggle-badge", "1");
    render(<Root />);
    // The switch is a control, not an unread marker: it stays for good, and
    // only the label under it goes.
    expect(modeButton()).toBeInTheDocument();
    expect(screen.getByText(/change mode/i)).toHaveClass(
      "app__mode-badge--faded",
    );
  });

  it("writes its own bit and none of the week's", () => {
    vi.useFakeTimers();
    try {
      render(<Root />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      // Each announcement keeps its own flag, so retiring one never counts as
      // having met another -- in any direction.
      expect(localStorage.getItem("ick:seen:mode-toggle-badge")).toBe("1");
      expect(localStorage.getItem("ick:seen:freeform-badge")).toBeNull();
      expect(
        localStorage.getItem("ick:seen:freeform-extended-badge"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not open the trial sheet, which is over", () => {
    render(<Root />);
    expect(sheet()).not.toBeInTheDocument();
  });
});
