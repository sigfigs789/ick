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
  it("defaults to checked: the shared text preview hides the words but keeps the rarity squares", () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /spoiler free/i });
    expect(toggle).toBeChecked();

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
      highScore: streak.highScore,
    }).split("\n")[0]);
  });

  it("shows the words in the shared text once toggled off", async () => {
    render(<ResultsPanel date="2025-01-01" drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /spoiler free/i });

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
    expect(preview?.querySelector("strong")?.textContent).toMatch(/https:\/\/wordink\.app #.*Ink: STR/);
  });
});
