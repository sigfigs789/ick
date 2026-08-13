import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackRegion } from "./FeedbackRegion";

afterEach(() => vi.useRealTimers());

describe("FeedbackRegion", () => {
  it("shows new feedback, then hides the toast after its display window", () => {
    vi.useFakeTimers();
    const { rerender } = render(<FeedbackRegion feedback={null} />);

    rerender(
      <FeedbackRegion
        feedback={{ kind: "rejected", message: "That's not in the word list.", key: 1 }}
      />
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("That's not in the word list.");
    expect(region).toHaveClass("feedback--rejected", "feedback--shown");

    act(() => vi.advanceTimersByTime(3200));
    expect(region).not.toHaveClass("feedback--shown");
  });

  it("keeps a live region in the DOM when there is no feedback", () => {
    render(<FeedbackRegion feedback={null} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
