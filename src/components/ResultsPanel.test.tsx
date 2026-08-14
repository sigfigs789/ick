import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "./ResultsPanel";
import { buildShareText } from "../game/share";
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
  it("defaults to unchecked: the shared text preview hides the words but keeps the rarity squares", () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /show my answers/i });
    expect(toggle).not.toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).not.toContain("strange");
    expect(preview?.textContent).not.toContain("aardvark");
    expect(preview?.textContent).toMatch(/⬜|🟩|🟦|🟪|🟧/);
  });

  it("uses the puzzle date in the shared heading", () => {
    const date = "2025-01-01";
    render(<ResultsPanel date={date} drop="str" words={words} streak={streak} />);

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain(buildShareText(date, "str", words, {
      spoilerFree: true,
      streak: streak.currentStreak,
      crushedIt: streak.crushedIt,
      elite: streak.elite,
    }).split("\n")[0]);
  });

  it("shows the words in the shared text once checked", async () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /show my answers/i });

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
    expect(preview?.querySelector("strong")?.textContent).toMatch(/wordink\.app\/\?utm_source=share #.*Drop: STR/);
  });

  it("offers an accessible X composer link with space for a player note", () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);

    const twitterLink = screen.getByRole("link", { name: /share on x/i });
    expect(twitterLink).toHaveAttribute("target", "_blank");
    expect(twitterLink).toHaveAttribute("title", "Share on X");
    expect(twitterLink.getAttribute("href")).toContain("twitter.com/intent/tweet");
    expect(decodeURIComponent(twitterLink.getAttribute("href") ?? "")).toContain(
      "\n\n──────────\nwordink.app #"
    );
  });
});
