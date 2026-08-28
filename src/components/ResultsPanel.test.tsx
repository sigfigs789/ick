import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "./ResultsPanel";
import { buildShareText } from "../game/share";
import { weekTotal } from "../game/totals";
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
    expect(preview?.textContent).toMatch(/⬜|🟩|🟦|🟪|🟧/);
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
        weekTotal: weekTotal(date),
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
      /\n\n────\n.*\nwordink\.app\/\?s=t$/s,
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
