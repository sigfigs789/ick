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

    act(() => vi.advanceTimersByTime(6000));
    expect(region).not.toHaveClass("feedback--shown");
  });

  it("keeps a live region in the DOM when there is no feedback", () => {
    render(<FeedbackRegion feedback={null} onWordRules={vi.fn()} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("holds the live note while the lookup runs, with no verdict to outlive", () => {
    vi.useFakeTimers();
    render(<FeedbackRegion feedback={null} note="Rummaging…" onWordRules={vi.fn()} />);

    const note = screen.getByText("Rummaging…");
    expect(note).toHaveClass("live-note--shown");

    // Well past the toast's window: a check still in flight must not fade out.
    act(() => vi.advanceTimersByTime(12000));
    expect(note).toHaveClass("live-note--shown");
  });

  it("fades the live note out together with the verdict it accompanies", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <FeedbackRegion feedback={null} note="Rummaging…" onWordRules={vi.fn()} />
    );

    // The verdict lands and the note switches to its past tense.
    rerender(
      <FeedbackRegion
        feedback={{ kind: "accepted", message: '"emesis" accepted — Rare.', key: 1 }}
        note="Rummaged."
        onWordRules={vi.fn()}
      />
    );
    const note = screen.getByText("Rummaged.");
    const toast = screen.getByRole("status");
    expect(note).toHaveClass("live-note--shown");
    expect(toast).toHaveClass("feedback--shown");

    // One shared window, so neither is left behind on screen.
    act(() => vi.advanceTimersByTime(6000));
    expect(note).not.toHaveClass("live-note--shown");
    expect(toast).not.toHaveClass("feedback--shown");
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
