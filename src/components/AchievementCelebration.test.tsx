import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementCelebration } from "./AchievementCelebration";
import { ACHIEVEMENTS } from "../game/achievements";

const byId = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

describe("AchievementCelebration", () => {
  afterEach(() => vi.useRealTimers());

  it("names one badge with its description", () => {
    render(<AchievementCelebration achievements={[byId("first-legend")]} onDone={() => {}} />);
    expect(screen.getByText("Achievement unlocked")).toBeInTheDocument();
    expect(screen.getByText("Living legend")).toBeInTheDocument();
    expect(screen.getByText("Find a Legend.")).toBeInTheDocument();
  });

  it("lists several at once", () => {
    render(
      <AchievementCelebration
        achievements={[byId("first-word"), byId("first-win"), byId("first-legend")]}
        onDone={() => {}}
      />
    );
    expect(screen.getByText("3 achievements unlocked")).toBeInTheDocument();
    expect(screen.getByText("First ink")).toBeInTheDocument();
    expect(screen.getByText("On the board")).toBeInTheDocument();
    expect(screen.getByText("Living legend")).toBeInTheDocument();
  });

  it("goes by itself after a while", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<AchievementCelebration achievements={[byId("first-word")]} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(7000));
    expect(onDone).toHaveBeenCalled();
  });
});
