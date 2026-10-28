import { act, fireEvent, render, screen } from "@testing-library/react";
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
        achievements={[byId("streak-3"), byId("first-extremely-rare"), byId("first-legend")]}
        onDone={() => {}}
      />
    );
    expect(screen.getByText("3 achievements unlocked")).toBeInTheDocument();
    expect(screen.getByText("Hat trick")).toBeInTheDocument();
    expect(screen.getByText("Sharp eye")).toBeInTheDocument();
    expect(screen.getByText("Living legend")).toBeInTheDocument();
  });

  it("counts the badges it does not name, and points to the Stats page for them", () => {
    render(
      <AchievementCelebration
        achievements={[byId("first-legend"), byId("streak-7"), byId("mythic-10")]}
        total={8}
        onDone={() => {}}
      />
    );
    expect(screen.getByText("8 achievements unlocked")).toBeInTheDocument();
    expect(screen.getByText("And 5 more. See them all on your Stats page.")).toBeInTheDocument();
  });

  it("names no more than three, however many a word earns", () => {
    render(
      <AchievementCelebration
        achievements={[byId("streak-3"), byId("first-extremely-rare"), byId("first-legend"), byId("streak-7")]}
        onDone={() => {}}
      />
    );
    expect(screen.getByText("4 achievements unlocked")).toBeInTheDocument();
    expect(document.querySelectorAll(".achievement-unlocked__item")).toHaveLength(3);
    expect(screen.getByText("And 1 more. See them all on your Stats page.")).toBeInTheDocument();
  });

  it("goes by itself after a while", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<AchievementCelebration achievements={[byId("first-legend")]} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(7000));
    expect(onDone).toHaveBeenCalled();
  });

  it("goes on a tap of its ×, but not on a tap elsewhere on it", () => {
    const onDone = vi.fn();
    render(<AchievementCelebration achievements={[byId("first-legend")]} onDone={onDone} />);
    fireEvent.click(document.querySelector(".improvement__card")!);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
