import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "./Root";
import { FREEFORM_START } from "./game/dictionary";

/**
 * Root under a date inside the trial week, which is the only way to see the
 * announcement at all -- the header button and the sheet both hang off
 * `isFreeformWeek(todayDateString())`.
 *
 * Its own file rather than a case in Root.test.tsx, because pinning today's
 * date is not something that file's other tests should have to share: they are
 * about the player id and the history sync, and both read the calendar.
 */
vi.mock("./game/date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game/date")>()),
  todayDateString: () => FREEFORM_START,
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
  beforeEach(() => localStorage.clear());

  it("reaches a first-timer, once the how-to-play sheet is out of the way", async () => {
    // Everybody gets it, including a browser with no history at all: the rules
    // it describes are the ones they are about to play under. A first-timer is
    // owed both sheets, and two dialogs in one paint delivers neither.
    render(<Root />);
    // The instructions come first, because they are the sheet that explains
    // what a score is.
    expect(howToPlay()).toBeInTheDocument();
    expect(sheet()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(howToPlay()).not.toBeInTheDocument();
    expect(sheet()).toBeInTheDocument();
  });

  it("reopens from the header button after it has been dismissed", async () => {
    localStorage.setItem("ick:seen:instructions", "1");
    render(<Root />);
    expect(sheet()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(sheet()).not.toBeInTheDocument();

    // The button stays all week and opens the sheet again -- dismissing it
    // retires the *automatic* opening, not the way back to it.
    await userEvent.click(screen.getByRole("button", { name: /freeform week/i }));
    expect(sheet()).toBeInTheDocument();
  });

  it("does not open itself twice, across mounts", () => {
    localStorage.setItem("ick:seen:instructions", "1");
    const first = render(<Root />);
    expect(sheet()).toBeInTheDocument();
    first.unmount();

    // Nothing was dismissed, so the flag is unset and it opens again. The flag
    // is what retires it, and it is written on close (see whatsNew).
    localStorage.setItem("ick:seen:freeform", "1");
    render(<Root />);
    expect(sheet()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /freeform week/i }),
    ).toBeInTheDocument();
  });
});
