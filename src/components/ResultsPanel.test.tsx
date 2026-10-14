import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
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

  it("offers an accessible X composer link with space for a player note", () => {
    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );

    const twitterLink = screen.getByRole("link", { name: /share on x/i });
    expect(twitterLink).toHaveAttribute("target", "_blank");
    expect(twitterLink).toHaveAttribute("title", "Share on X");
    expect(twitterLink.getAttribute("href")).toContain(
      "twitter.com/intent/tweet",
    );
    expect(decodeURIComponent(twitterLink.getAttribute("href") ?? "")).toMatch(
      /\n\n────\n.*\nwordink\.app\/\?s=t\.[fs]$/s,
    );
  });

  it("keeps answers in the X post when the player opts in, using the compact layout", async () => {
    render(
      <ResultsPanel
        date="2025-01-01"
        drop="str"
        words={words}
        streak={streak}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /^all$/i }));

    const xPost = decodeURIComponent(
      screen.getByRole("link", { name: /share on x/i }).getAttribute("href") ??
        "",
    );
    expect(xPost).toContain("strange (4.6)");
    expect(xPost).not.toContain("Streak:");
    expect(xPost).not.toContain("Top:");
  });
});

describe("ResultsPanel username", () => {
  const PLAYER_ID = "00000000-0000-4000-8000-000000000000";
  const preview = () =>
    document.querySelector(".results-panel__preview")?.textContent ?? "";

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: PLAYER_ID }));
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

  it("offers no toggle to a browser with no name to share", () => {
    localStorage.clear();
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    expect(screen.queryByRole("checkbox", { name: /show username/i })).toBeNull();
    expect(preview()).not.toContain("Playing as");
  });
});

describe("the Freeform preview", () => {
  it("paints one hue per letter of the mode beside the score", () => {
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
