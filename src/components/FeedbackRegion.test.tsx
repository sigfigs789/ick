import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackRegion } from "./FeedbackRegion";
import { LIVE_CHECK_NOTE } from "../hooks/useDailyPuzzle";

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

    act(() => vi.advanceTimersByTime(6000));
    expect(region).not.toHaveClass("feedback--shown");
  });

  it("keeps a live region in the DOM when there is no feedback", () => {
    render(<FeedbackRegion feedback={null} onWordRules={vi.fn()} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps the note below the verdict so the verdict pushes it down", () => {
    const { rerender } = render(
      <FeedbackRegion feedback={null} note={LIVE_CHECK_NOTE} onWordRules={vi.fn()} />
    );

    // While the check runs, the note is the only thing with text.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText(LIVE_CHECK_NOTE)).toBeInTheDocument();

    rerender(
      <FeedbackRegion
        feedback={{ kind: "accepted", message: '"emesis" accepted — Rare.', key: 1 }}
        note={LIVE_CHECK_NOTE}
        onWordRules={vi.fn()}
      />
    );

    // Both are present, and the verdict comes first in document order, so it
    // renders above and displaces the note downward.
    const stack = screen.getByText(LIVE_CHECK_NOTE).parentElement!;
    const texts = [...stack.children].map((child) => child.textContent);
    expect(texts[0]).toContain('"emesis" accepted');
    expect(texts[1]).toBe(LIVE_CHECK_NOTE);
  });

  it("offers rejected submissions a link to the word rules", async () => {
    const onWordRules = vi.fn();
    render(
      <FeedbackRegion
        feedback={{ kind: "rejected", message: "That word is not in WordInk's curated list.", key: 1 }}
        onWordRules={onWordRules}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "More info" }));
    expect(onWordRules).toHaveBeenCalledOnce();
  });
});
