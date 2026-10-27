import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreakState } from "../game/types";
import { QuickShareButton } from "./QuickShareButton";

vi.mock("../analytics", () => ({
  isReporting: vi.fn(() => false),
  trackResultCopied: vi.fn(),
  trackShareNameAssigned: vi.fn(),
}));

const props = {
  date: "2026-10-27",
  drop: "STR",
  words: [{ word: "strobile", rarity: "Extremely Rare" as const, zipf: 1.5 }],
  streak: {
    currentStreak: 1,
    longestStreak: 1,
    totalCompleted: 1,
    crushedIt: 1,
    elite: 0,
    highScore: 8.4,
  } satisfies StreakState,
  isToday: true,
};

describe("QuickShareButton", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    writeText.mockReset();
    localStorage.clear();
  });

  it("sits still unless asked to nudge", () => {
    render(<QuickShareButton {...props} />);
    expect(screen.getByRole("button", { name: "Share" })).not.toHaveClass("quick-share--nudge");
  });

  it("wiggles when nudging, and stops for good once it has copied", async () => {
    render(<QuickShareButton {...props} nudge />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button).toHaveClass("quick-share--nudge");

    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveClass("quick-share--nudge");
  });
});
