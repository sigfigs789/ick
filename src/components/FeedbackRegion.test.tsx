import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackRegion } from "./FeedbackRegion";

afterEach(() => vi.useRealTimers());

describe("FeedbackRegion", () => {
  it("shows new feedback, then hides the toast after its display window", () => {
    vi.useFakeTimers();
    const { rerender } = render(<FeedbackRegion feedback={null} onWordRules={vi.fn()} />);

    rerender(
      <FeedbackRegion
        feedback={{
          kind: "rejected",
          message: "That word is not in WordInk's curated list.",
          key: 1,
        }}
        onWordRules={vi.fn()}
      />
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("That word is not in WordInk's curated list.");
    expect(region).toHaveClass("feedback--rejected", "feedback--shown");

    act(() => vi.advanceTimersByTime(3200));
    expect(region).not.toHaveClass("feedback--shown");
  });

  it("keeps a live region in the DOM when there is no feedback", () => {
    render(<FeedbackRegion feedback={null} onWordRules={vi.fn()} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("offers rejected submissions a link to the word rules", async () => {
    const onWordRules = vi.fn();
    render(
      <FeedbackRegion
        feedback={{ kind: "rejected", message: "That word is not in WordInk's curated list.", key: 1 }}
        onWordRules={onWordRules}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /learn about wordink's word rules/i }));
    expect(onWordRules).toHaveBeenCalledOnce();
  });
});
