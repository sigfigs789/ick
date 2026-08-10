import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "./ResultsPanel";
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
  it("defaults to unchecked: the shared text preview includes the words", () => {
    render(<ResultsPanel drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /spoiler free/i });
    expect(toggle).not.toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
    expect(preview?.querySelector("strong")?.textContent).toBe("Drop: STR");
  });

  it("hides the words in the shared text once toggled on, but keeps the rarity squares", async () => {
    render(<ResultsPanel drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /spoiler free/i });

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).not.toContain("strange");
    expect(preview?.textContent).not.toContain("aardvark");
    expect(preview?.textContent).toMatch(/⬜|🟩|🟦|🟪|🟧/);
  });
});
