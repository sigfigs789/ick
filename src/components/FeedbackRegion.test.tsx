import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackRegion } from "./FeedbackRegion";

afterEach(() => vi.useRealTimers());

/** A pending note, ellipsis and all -- the trailing "…" is what earns the dots. */
const PENDING = "Digging through dictionaries…";

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
    render(<FeedbackRegion feedback={null} note={PENDING} onWordRules={vi.fn()} />);

    const note = screen.getByText("Digging through dictionaries");
    expect(note).toHaveClass("live-note--shown");

    // Well past the toast's window: a check still in flight must not fade out.
    act(() => vi.advanceTimersByTime(12000));
    expect(note).toHaveClass("live-note--shown");
  });

  it("animates the dots of a note still in flight, and drops them once it settles", () => {
    const { rerender } = render(
      <FeedbackRegion feedback={null} note={PENDING} onWordRules={vi.fn()} />
    );

    // The stem stays one plain text node -- it is what gets announced -- and the
    // dots are decoration hidden from the screen reader.
    const note = screen.getByText("Digging through dictionaries");
    const dots = note.querySelector(".live-note__dots");
    expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(note.querySelectorAll(".live-note__dot")).toHaveLength(3);
    expect(note).toHaveTextContent("Digging through dictionaries...");

    // A settled note is a finished sentence, not a wait: nothing to animate.
    rerender(<FeedbackRegion feedback={null} note="Found it!" onWordRules={vi.fn()} />);
    expect(screen.getByText("Found it!").querySelector(".live-note__dots")).toBeNull();
  });

  it("fades the live note out together with the verdict it accompanies", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <FeedbackRegion feedback={null} note={PENDING} onWordRules={vi.fn()} />
    );

    // The verdict lands and the note switches to its past tense.
    rerender(
      <FeedbackRegion
        feedback={{ kind: "accepted", message: '"emesis" accepted — Rare.', key: 1 }}
        note="Found it!"
        onWordRules={vi.fn()}
      />
    );
    const note = screen.getByText("Found it!");
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
