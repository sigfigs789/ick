import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";
import { trackFoundWordsOpened, trackLeaderboardOpened, trackStatsOpened } from "../analytics";
import { useRoute } from "../routes";

vi.mock("../analytics", () => ({
  trackLeaderboardOpened: vi.fn(),
  trackFoundWordsOpened: vi.fn(),
  trackStatsOpened: vi.fn(),
  trackModeChanged: vi.fn(),
}));

const howToPlay = vi.fn();

/**
 * The header wired to the real router, which is the only way to see the thing
 * it is for: a tab is a tab because pressing it changes the page under it.
 */
function Harness() {
  const route = useRoute();
  return <AppHeader route={route} onHowToPlay={howToPlay} />;
}

/** Open the "?" menu, where the rules and the mode switch live. */
async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Help and settings" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

describe("the header", () => {
  it("names each page by its icon, and the wordmark goes home", async () => {
    window.history.pushState(null, "", "/leaderboard");
    render(<Harness />);

    // Icons on the bar, each named and titled with its page.
    expect(screen.getByRole("button", { name: "Words found" })).toHaveAttribute("title", "Words found");
    expect(screen.getByRole("button", { name: "Leaderboards" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The puzzle has no icon: the wordmark is the way back to it.
    await userEvent.click(screen.getByRole("link", { name: /^Word ?Ink$/ }));
    expect(window.location.pathname).toBe("/");
  });

  it("puts the finds before the boards", () => {
    render(<Harness />);

    const labels = within(screen.getByRole("navigation", { name: "Pages" }))
      .getAllByRole("button")
      .map((tab) => tab.getAttribute("aria-label"));
    expect(labels).toEqual(["Words found", "Stats", "Leaderboards"]);
  });

  it("goes to each page, and moves the current marker with it", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: /Leaderboards/ }));
    // A real page at a real URL, not a modal over the puzzle.
    expect(window.location.pathname).toBe("/leaderboard");
    expect(
      screen.getByRole("button", { name: "Leaderboards" }),
    ).toHaveAttribute("aria-current", "page");

    // And straight across to the other one, without passing through the game --
    // which is the whole reason the header is on every page.
    await userEvent.click(screen.getByRole("button", { name: "Words found" }));
    expect(window.location.pathname).toBe("/found-words");
    expect(trackLeaderboardOpened).toHaveBeenCalledWith("header");
    expect(trackFoundWordsOpened).toHaveBeenCalledWith("header");
  });

  it("offers Stats from the first visit, right after the finds", async () => {
    // No record needed: the page has an empty state of its own.
    render(<AppHeader route="game" onHowToPlay={howToPlay} />);
    const labels = within(screen.getByRole("navigation", { name: "Pages" }))
      .getAllByRole("button")
      .map((tab) => tab.getAttribute("aria-label"));
    expect(labels).toEqual(["Words found", "Stats", "Leaderboards"]);

    await userEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(window.location.pathname).toBe("/stats");
    expect(trackStatsOpened).toHaveBeenCalledWith("header");
  });

  it("keeps the Stats tab on the Stats page itself", () => {
    render(<AppHeader route="stats" onHowToPlay={howToPlay} />);
    expect(screen.getByRole("button", { name: "Stats" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the wordmark as the page's h1 only on the puzzle", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "WordInk",
    );

    // The other two pages have a heading of their own that says what they are,
    // and two h1s is a worse answer to "what is this" than either alone.
    unmount();
    window.history.pushState(null, "", "/leaderboard");
    render(<Harness />);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    // "Ink" is its own span, so the name is found by its paragraph's text.
    expect(
      screen.getByText(
        (_, el) =>
          el?.className === "app__wordmark" &&
          el.textContent?.startsWith("WordInk") === true,
      ),
    ).toBeInTheDocument();
  });

  it("asks for the rules from any page", async () => {
    window.history.pushState(null, "", "/found-words");
    render(<Harness />);

    // It used to live on the game alone, so a reader of the boards had to go
    // back to the puzzle to check what a rank was made of.
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(howToPlay).toHaveBeenCalled();
    // A choice closes the menu behind it.
    expect(screen.queryByRole("button", { name: /how to play/i })).not.toBeInTheDocument();
  });

  it("offers feedback and word suggestions in the menu only when wired", async () => {
    const onOpenSheet = vi.fn();
    const { rerender } = render(<AppHeader route="game" onHowToPlay={howToPlay} />);
    await openMenu();
    expect(screen.queryByRole("button", { name: "Feedback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest a word" })).not.toBeInTheDocument();

    rerender(<AppHeader route="game" onHowToPlay={howToPlay} onOpenSheet={onOpenSheet} />);
    await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(onOpenSheet).toHaveBeenLastCalledWith("feedback");
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Suggest a word" }));
    expect(onOpenSheet).toHaveBeenLastCalledWith("suggest-word");
  });

  it("closes the menu on Escape, handing focus back to the \"?\"", async () => {
    render(<Harness />);
    await openMenu();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /how to play/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help and settings" })).toHaveFocus();
  });
});

describe("the trial week's button", () => {
  it("opens the week's notice, and finishes the badge with it", async () => {
    const onFreeform = vi.fn();
    const onBadgeDone = vi.fn();
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        onFreeform={onFreeform}
        badgeLabel="Freeform extended 1 week"
        onBadgeDone={onBadgeDone}
      />,
    );
    // Unchanged from the week it was built for: the trial runs to
    // MODE_CHOICE_START and the header is the trial's until then.
    expect(screen.getByText(/freeform extended 1 week/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /freeform week/i }));
    expect(onFreeform).toHaveBeenCalled();
    expect(onBadgeDone).toHaveBeenCalled();
  });

  it("offers no switch alongside it -- one slot, one era", () => {
    render(
      <AppHeader route="game" onHowToPlay={howToPlay} onFreeform={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /switch to/i }),
    ).not.toBeInTheDocument();
  });

  it("says the badge is finished once its ten seconds are up", () => {
    vi.useFakeTimers();
    try {
      const onBadgeDone = vi.fn();
      render(
        <AppHeader
          route="game"
          onHowToPlay={howToPlay}
          onFreeform={vi.fn()}
          badgeLabel="Freeform extended 1 week"
          onBadgeDone={onBadgeDone}
        />,
      );
      expect(onBadgeDone).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      // Sitting in front of the player for ten seconds is the eye having had
      // its chance, and counts the same as a press.
      expect(onBadgeDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart the ten seconds when the parent re-renders", () => {
    vi.useFakeTimers();
    try {
      const onBadgeDone = vi.fn();
      const header = () => (
        <AppHeader
          route="game"
          onHowToPlay={howToPlay}
          // Fresh arrows every render, as the real parent hands over.
          onFreeform={() => {}}
          badgeLabel="Freeform extended 1 week"
          onBadgeDone={() => onBadgeDone()}
        />
      );
      const { rerender } = render(header());

      // The puzzle above this re-renders on every keystroke; a badge whose
      // clock started over each time would never reach ten seconds.
      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      rerender(header());
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(onBadgeDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fades a finished badge and leaves the button alone", () => {
    vi.useFakeTimers();
    try {
      render(
        <AppHeader
          route="game"
          onHowToPlay={howToPlay}
          onFreeform={vi.fn()}
          badgeLabel="Freeform extended 1 week"
          badge={false}
        />,
      );

      // Faded rather than unmounted: it is absolutely positioned, so fading it
      // moves nothing, and the button it points at stays exactly where the eye
      // found it -- permanently, which is the half that must not fade.
      expect(screen.getByText(/freeform extended 1 week/i)).toHaveClass(
        "app__freeform-badge--faded",
      );
      expect(
        screen.getByRole("button", { name: /freeform week/i }),
      ).toBeInTheDocument();

      // And no timer for a badge that is already done.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the mode switch", () => {
  it("is absent when neither era is offered", () => {
    render(<AppHeader route="game" onHowToPlay={howToPlay} />);
    expect(
      screen.queryByRole("button", { name: /switch to/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Mode" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /freeform week/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/change mode/i)).not.toBeInTheDocument();
  });

  it("is a Standard | Freeform toggle in the menu, with the current one checked", async () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={onModeChange}
      />,
    );
    // Tucked in the "?" menu, out of the puzzle's way.
    expect(screen.queryByRole("radiogroup", { name: "Mode" })).not.toBeInTheDocument();
    await openMenu();
    const standard = screen.getByRole("radio", { name: "Standard" });
    const freeform = screen.getByRole("radio", { name: "Freeform" });
    expect(standard).toHaveAttribute("aria-checked", "true");
    expect(freeform).toHaveAttribute("aria-checked", "false");

    // Picking the mode you are in is nothing; picking the other one switches,
    // and the menu stays open to show it.
    await userEvent.click(standard);
    expect(onModeChange).not.toHaveBeenCalled();
    await userEvent.click(freeform);
    expect(onModeChange).toHaveBeenCalledWith("freeform");
    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
  });

  it("switches back the other way from Freeform", async () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="freeform"
        onModeChange={onModeChange}
      />,
    );
    await openMenu();
    await userEvent.click(screen.getByRole("radio", { name: "Standard" }));
    expect(onModeChange).toHaveBeenCalledWith("standard");
  });

  it("wears no badge, even when handed a label", async () => {
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={vi.fn()}
        badgeLabel="Two ways to play"
      />,
    );
    await openMenu();
    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
    expect(screen.queryByText(/two ways to play/i)).toBeNull();
  });
});

describe("the docked mode switch", () => {
  /** A stand-in observer the test drives: `report(false)` is the header's
   * switch leaving the screen. */
  let report: (visible: boolean) => void = () => {};
  beforeEach(() => {
    report = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = (visible) => callback([{ isIntersecting: visible }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    return () => vi.unstubAllGlobals();
  });

  const switches = () =>
    screen.queryAllByRole("button", { name: /switch to/i });

  it("follows the reader down the finds once the header has scrolled away", async () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader
        route="found-words"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={onModeChange}
      />,
    );
    // In the menu while the header is on screen, and out on the page once it
    // has scrolled away.
    expect(switches()).toHaveLength(0);
    act(() => report(false));
    expect(switches()).toHaveLength(1);
    await userEvent.click(switches()[0]);
    expect(onModeChange).toHaveBeenCalledWith("freeform");
    act(() => report(true));
    expect(switches()).toHaveLength(0);
  });

  it("stays in the menu on the puzzle, whose input sits under the header", () => {
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="freeform"
        onModeChange={vi.fn()}
      />,
    );
    expect(switches()).toHaveLength(0);
    act(() => report(false));
    expect(switches()).toHaveLength(0);
  });
});
