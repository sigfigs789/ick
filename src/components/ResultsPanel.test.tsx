import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackShareNameAssigned, trackShareNameToggled } = vi.hoisted(() => ({
  trackShareNameAssigned: vi.fn(),
  trackShareNameToggled: vi.fn(),
}));
vi.mock("../analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../analytics")>()),
  trackShareNameAssigned,
  trackShareNameToggled,
}));

import { ResultsPanel } from "./ResultsPanel";
import { buildShareText } from "../game/share";
import { PLAYER_KEY } from "../game/player";
import { handleFor } from "../game/handle";
import { MODE_CHOICE_START } from "../game/mode";
import type { AcceptedWord, StreakState } from "../game/types";

const words: AcceptedWord[] = [
  { word: "strange", rarity: "Common", zipf: 4.6 },
  { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
];

const streak: StreakState = {
  currentStreak: 1,
  longestStreak: 1,
  totalCompleted: 1,
  crushedIt: 1,
  elite: 0,
  highScore: 6.8,
};

describe("ResultsPanel share toggle", () => {
  // The toggle remembers its last choice, so each test starts from a player who
  // has never touched it.
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to Top: names only the rarest word, keeping the rest anonymous", () => {
    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    expect(screen.getByRole("radio", { name: /^top$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /hide/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /^all$/i })).not.toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    // aardvark (zipf 2.4) is the rarest of the two, so it is the only one named.
    expect(preview?.textContent).toContain("aardvark");
    expect(preview?.textContent).not.toContain("strange");
  });

  it("Hide keeps the share fully spoiler-free, showing squares but no words", async () => {
    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /hide/i }));

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).not.toContain("strange");
    expect(preview?.textContent).not.toContain("aardvark");
    expect(preview?.textContent).toMatch(/⬜|🟩|🟦|🟪|🟨|🟧/);
  });

  it("remembers the choice for the next result", async () => {
    const { unmount } = render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /^all$/i }));
    unmount();

    // A later puzzle, as a reload or the next day would draw it.
    render(
      <ResultsPanel
        date="2025-01-02"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    expect(screen.getByRole("radio", { name: /^all$/i })).toBeChecked();
    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
  });

  it("uses the puzzle date in the shared heading", () => {
    const date = "2025-01-01";
    render(
      <ResultsPanel date={date} drop="str" words={words} streak={streak} />,
    );

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain(
      buildShareText(date, "str", words, {
        spoilerFree: true,
        streak: streak.currentStreak,
      }).split("\n")[0],
    );
  });

  it('labels the score "Today" only when the panel is on the current puzzle', () => {
    const { unmount } = render(
      <ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />,
    );
    expect(
      document.querySelector(".results-panel__preview")?.textContent,
    ).toContain("Total:");
    unmount();

    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
        isToday
      />,
    );
    expect(
      document.querySelector(".results-panel__preview")?.textContent,
    ).toContain("Today:");
  });

  it("shows every word in the shared text once All is selected", async () => {
    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    const allToggle = screen.getByRole("radio", { name: /^all$/i });

    await userEvent.click(allToggle);
    expect(allToggle).toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
    expect(preview?.querySelector("strong")?.textContent).toBe(
      "Jan 1 — Drop: STR",
    );
  });

  it("offers one Share, with no X button and no leaderboard link", () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /share on x/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leaderboard/i })).not.toBeInTheDocument();
  });

  it("shows what Share copies, folds the choices, and puts Share last when collapsible", async () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} collapsible />);
    const panel = screen.getByRole("region", { name: /share result/i });
    // The preview of what was copied is there from the start.
    const preview = document.querySelector(".results-panel__preview");
    expect(preview).not.toBeNull();
    // The choices are not, until asked for.
    expect(screen.queryByRole("radio", { name: /^all$/i })).not.toBeInTheDocument();
    // Share is the panel's last control.
    const buttons = within(panel).getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveAccessibleName(/^share$/i);

    const toggle = screen.getByRole("button", { name: /share options/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radio", { name: /^all$/i })).toBeInTheDocument();
  });

  it("scrolls itself into view each time it is asked for, and not before", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const props = { date: "2025-01-01", drop: "str", words, streak, collapsible: true };
    const { rerender } = render(<ResultsPanel {...props} scrollSignal={0} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<ResultsPanel {...props} scrollSignal={1} />);
    rerender(<ResultsPanel {...props} scrollSignal={2} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("ResultsPanel username", () => {
  const PLAYER_ID = "00000000-0000-4000-8000-000000000000";
  const preview = () =>
    document.querySelector(".results-panel__preview")?.textContent ?? "";

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: PLAYER_ID }));
    // In the share name test's arm that keeps the old default (see
    // game/shareNameTest.ts), unless a test says otherwise.
    localStorage.setItem("ick:share-name-test", "shown");
    trackShareNameAssigned.mockClear();
    trackShareNameToggled.mockClear();
  });

  it("says who is playing by default, in place of the week and month totals", () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("checkbox", { name: /show username/i })).toBeChecked();
    expect(preview()).toContain(`Playing as ${handleFor(PLAYER_ID)}`);
    expect(preview()).not.toContain("Week:");
    expect(preview()).not.toContain("Month:");
    expect(preview()).not.toMatch(/1 in \S+ words/);
  });

  it("hides the name when switched off, and remembers that for the next result", async () => {
    const { unmount } = render(
      <ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /show username/i }));
    expect(preview()).not.toContain("Playing as");
    unmount();

    render(<ResultsPanel date="2025-01-02" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("checkbox", { name: /show username/i })).not.toBeChecked();
    expect(preview()).not.toContain("Playing as");
  });

  it("starts with the name off in the share name test's hidden arm", () => {
    localStorage.setItem("ick:share-name-test", "hidden");
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("checkbox", { name: /show username/i })).not.toBeChecked();
    expect(preview()).not.toContain("Playing as");
    expect(trackShareNameAssigned).not.toHaveBeenCalled();
  });

  it("draws a player who has never chosen into the test once, marked new or returning", () => {
    localStorage.removeItem("ick:share-name-test");
    const { unmount } = render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    const variant = localStorage.getItem("ick:share-name-test");
    expect(variant === "shown" || variant === "hidden").toBe(true);
    expect((screen.getByRole("checkbox", { name: /show username/i }) as HTMLInputElement).checked).toBe(
      variant === "shown",
    );
    expect(trackShareNameAssigned).toHaveBeenCalledTimes(1);
    expect(trackShareNameAssigned).toHaveBeenCalledWith(variant, "2025-01-01", false);
    unmount();

    render(<ResultsPanel date="2025-01-02" drop="str" words={words} streak={streak} />);
    expect(trackShareNameAssigned).toHaveBeenCalledTimes(1);
  });

  it("never draws a player who has set the toggle", () => {
    localStorage.removeItem("ick:share-name-test");
    localStorage.setItem("ick:share-name", "show");
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("checkbox", { name: /show username/i })).toBeChecked();
    expect(localStorage.getItem("ick:share-name-test")).toBeNull();
    expect(trackShareNameAssigned).not.toHaveBeenCalled();
  });

  it("keeps a drawn player's arm when they set the toggle, and reports the override", async () => {
    localStorage.setItem("ick:share-name-test", "hidden");
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /show username/i }));
    expect(preview()).toContain(`Playing as ${handleFor(PLAYER_ID)}`);
    expect(localStorage.getItem("ick:share-name-test")).toBe("hidden");
    expect(trackShareNameToggled).toHaveBeenCalledWith("hidden", true, "2025-01-01");
  });

  it("never draws a player kept out for setting the toggle before the test", async () => {
    localStorage.setItem("ick:share-name-test", "excluded");
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.getByRole("checkbox", { name: /show username/i })).toBeChecked();
    expect(localStorage.getItem("ick:share-name-test")).toBe("excluded");
    expect(trackShareNameAssigned).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: /show username/i }));
    expect(trackShareNameToggled).not.toHaveBeenCalled();
  });

  it("offers no toggle to a browser with no name to share", () => {
    localStorage.clear();
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.queryByRole("checkbox", { name: /show username/i })).toBeNull();
    expect(preview()).not.toContain("Playing as");
  });
});

describe("the Freeform preview", () => {
  it("paints one hue per letter of the mode on the heading", () => {
    const { container } = render(
      <ResultsPanel
        date={MODE_CHOICE_START}
        drop="str"
        words={words}
        streak={streak}
        isToday
        mode="freeform"
      />,
    );

    const letters = container.querySelectorAll(".rainbow-word__letter");
    expect([...letters].map((el) => el.textContent).join("")).toBe("Freeform");
    // Spread across the whole word rather than fixed per position, so the first
    // letter starts at red and the last reaches the far end of the sweep.
    const hues = [...letters].map((el) =>
      Number((el as HTMLElement).style.getPropertyValue("--rainbow-hue")),
    );
    expect(hues[0]).toBe(0);
    expect(hues[hues.length - 1]).toBe(300);
    expect(hues).toEqual([...hues].sort((a, b) => a - b));
  });

  it("leaves a Standard preview as plain text", () => {
    const { container } = render(
      <ResultsPanel
        date={MODE_CHOICE_START}
        drop="str"
        words={words}
        streak={streak}
        isToday
        mode="standard"
      />,
    );
    expect(container.querySelector(".rainbow-word")).toBeNull();
    expect(screen.getByLabelText("Share result")).toHaveTextContent(/Today:/);
  });

  it("keeps the text that actually leaves the app plain", () => {
    // Colour is a property of this rendering, not of the share: what goes to a
    // clipboard or an X post is plain text and has no colour to carry.
    const text = buildShareText(MODE_CHOICE_START, "str", words, {
      isToday: true,
      mode: "freeform",
      streak: 1,
      playerName: "StormyFox47",
    });
    expect(text).toContain("· Freeform");
    expect(text).not.toContain("<");
  });
});
