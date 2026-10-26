import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PerfectMonthCelebration } from "./PerfectMonthCelebration";
import { perfectMonthName } from "../game/perfectMonth";

describe("PerfectMonthCelebration", () => {
  it("names the month and the tally, over the grand confetti", () => {
    render(<PerfectMonthCelebration date="2026-09-30" days={30} onDone={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      `Perfect ${perfectMonthName("2026-09-30")}!`
    );
    expect(screen.getByRole("status")).toHaveTextContent("30 for 30");
    expect(document.querySelectorAll(".confetti--grand .confetti__piece")).toHaveLength(48);
  });

  it("stays until it is tapped away", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<PerfectMonthCelebration date="2026-09-30" days={30} onDone={onDone} />);
    vi.advanceTimersByTime(60_000);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
