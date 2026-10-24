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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

describe("the header", () => {
  it("names all three pages, and says which one you are on", () => {
    render(<Harness />);

    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Leaderboards")).toBeInTheDocument();
    // Named for what the page opens on, which is what brings anybody back to
    // it through the day.
    expect(screen.getByText("Words found")).toBeInTheDocument();
    // Labels, not a row of glyphs: a trophy and a scroll cannot say which of
    // the two lists of words is which.
    expect(screen.getByRole("button", { name: /^Play$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("puts the finds before the boards", () => {
    render(<Harness />);

    const labels = screen
      .getAllByRole("button", { name: /^(Play|Words found|Leaderboards)$/ })
      .map((tab) => tab.getAttribute("aria-label"));
    expect(labels).toEqual(["Play", "Words found", "Leaderboards"]);
  });

  it("gives a phone shorter labels, still named in full", () => {
    render(<Harness />);

    // CSS shows these below 480px; the tab is still announced by its full name.
    expect(within(screen.getByRole("button", { name: "Words found" })).getByText("Words")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Leaderboards" })).getByText("Ranks")).toBeInTheDocument();
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

  it("offers Stats only once there is a record, right after the finds", async () => {
    const { rerender } = render(<AppHeader route="game" onHowToPlay={howToPlay} />);
    expect(screen.queryByRole("button", { name: "Stats" })).not.toBeInTheDocument();

    rerender(<AppHeader route="game" onHowToPlay={howToPlay} showStats />);
    const labels = screen
      .getAllByRole("button", { name: /^(Play|Words found|Stats|Leaderboards)$/ })
      .map((tab) => tab.getAttribute("aria-label"));
    expect(labels).toEqual(["Play", "Words found", "Stats", "Leaderboards"]);

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
    await userEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(howToPlay).toHaveBeenCalled();
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
    expect(
      screen.queryByRole("button", { name: /freeform week/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/change mode/i)).not.toBeInTheDocument();
  });

  it("names the mode you are in and where pressing goes", async () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={onModeChange}
      />,
    );
    // The label is where you are; the accessible name carries the destination,
    // which is the half a screen reader needs and the glyph cannot give.
    const button = screen.getByRole("button", {
      name: "Mode: Standard. Switch to Freeform.",
    });
    expect(button).toHaveTextContent("Standard");
    await userEvent.click(button);
    expect(onModeChange).toHaveBeenCalledWith("freeform");
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
    await userEvent.click(
      screen.getByRole("button", { name: /switch to standard/i }),
    );
    expect(onModeChange).toHaveBeenCalledWith("standard");
  });

  it("wears no badge, even when handed a label", () => {
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={vi.fn()}
        badgeLabel="Two ways to play"
      />,
    );
    expect(
      screen.getByRole("button", { name: /switch to freeform/i }),
    ).toBeInTheDocument();
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

  it("follows the reader down the finds once the header's has scrolled away", async () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader
        route="found-words"
        onHowToPlay={howToPlay}
        mode="standard"
        onModeChange={onModeChange}
      />,
    );
    // One switch while the header's is on screen -- never two at once.
    expect(switches()).toHaveLength(1);
    act(() => report(false));
    expect(switches()).toHaveLength(2);
    await userEvent.click(switches()[1]);
    expect(onModeChange).toHaveBeenCalledWith("freeform");
    act(() => report(true));
    expect(switches()).toHaveLength(1);
  });

  it("stays in the header on the puzzle, whose input sits under it", () => {
    render(
      <AppHeader
        route="game"
        onHowToPlay={howToPlay}
        mode="freeform"
        onModeChange={vi.fn()}
      />,
    );
    expect(switches()).toHaveLength(1);
    act(() => report(false));
    expect(switches()).toHaveLength(1);
  });
});
