import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "./ResultsPanel";
import type { AcceptedWord, StreakState } from "../game/types";

const words: AcceptedWord[] = [
  { word: "strange", rarity: "Common", zipf: 4.6 },
  { word: "aardvark", rarity: "Extremely Rare", zipf: 2.4 },
];

const streak: StreakState = { currentStreak: 1, longestStreak: 1, totalCompleted: 1 };

describe("ResultsPanel share toggle", () => {
  it("defaults to spoiler-free: the shared text preview has no words in it", () => {
    render(<ResultsPanel drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /show words in shared result/i });
    expect(toggle).not.toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).not.toContain("strange");
    expect(preview?.textContent).not.toContain("aardvark");
  });

  it("reveals the words in the shared text once toggled on", async () => {
    render(<ResultsPanel drop="str" words={words} streak={streak} />);
    const toggle = screen.getByRole("checkbox", { name: /show words in shared result/i });

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();

    const preview = document.querySelector(".results-panel__preview");
    expect(preview?.textContent).toContain("strange");
    expect(preview?.textContent).toContain("aardvark");
  });
});
