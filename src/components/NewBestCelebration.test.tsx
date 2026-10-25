import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewBestCelebration } from "./NewBestCelebration";

describe("NewBestCelebration", () => {
  it("names the new streak and the best it passed, over the rising confetti", () => {
    render(<NewBestCelebration days={10} best={9} onDone={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Your longest streak yet!");
    expect(status).toHaveTextContent("10 days — past your best of 9.");
    expect(document.querySelectorAll(".confetti--rising .confetti__piece")).toHaveLength(48);
  });

  it("goes on a tap, or by itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<NewBestCelebration days={3} best={2} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000);
    expect(onDone).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
