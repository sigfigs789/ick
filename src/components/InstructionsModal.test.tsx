import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODE_CHOICE_START, resetModeCache, setMode } from "../game/mode";
import { InstructionsModal } from "./InstructionsModal";

const trackFeedbackSubmitted = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackFeedbackSubmitted }));

// The real clock by default, so the single-mode cases keep describing the sheet
// players see today; the mode cases move it to MODE_CHOICE_START.
const clock = vi.hoisted(() => ({ today: null as string | null }));
vi.mock("../game/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/date")>();
  return {
    ...actual,
    todayDateString: () => clock.today ?? actual.todayDateString(),
  };
});

describe("InstructionsModal", () => {
  it("does not render until opened, then focuses its close button", () => {
    const { rerender } = render(
      <InstructionsModal
        open={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <InstructionsModal
        open
        onClose={vi.fn()}
      />,
    );
    // "Ink" is its own span in the heading, and jsdom has no layout to know
    // it is inline, so the computed name comes back as "Word Ink".
    expect(
      screen.getByRole("dialog", { name: /how to play word ?ink/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close instructions/i }),
    ).toHaveFocus();
  });

  it("names Mythic and Legend as the highest ranks with their rarity thresholds", () => {
    render(
      <InstructionsModal
        open
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /the highest ranks are Mythic at 9\.5\+ and Legend at 9\.9\+/i,
      ),
    ).toBeInTheDocument();
  });

  it("closes from Escape, its close button, or the backdrop, but not an in-dialog click", async () => {
    const onClose = vi.fn();
    render(
      <InstructionsModal
        open
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole("dialog");

    await userEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /close instructions/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("sends trimmed feedback to analytics, then clears the box and thanks the player", async () => {
    trackFeedbackSubmitted.mockClear();
    render(
      <InstructionsModal
        open
        onClose={vi.fn()}
      />,
    );
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);
    const send = screen.getByRole("button", { name: /^send$/i });
    expect(send).toBeDisabled();

    await userEvent.type(box, "  more vowel drops please  ");
    await userEvent.click(send);

    expect(trackFeedbackSubmitted).toHaveBeenCalledWith(
      "more vowel drops please",
    );
    expect(box).toHaveValue("");
    expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
  });

  it("thanks the player without pointing them at everybody else's notes", async () => {
    window.history.pushState(null, "", "/");
    render(<InstructionsModal open onClose={vi.fn()} />);

    await userEvent.type(
      screen.getByLabelText(/share feedback or leave a suggestion/i),
      "more vowel drops please",
    );
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // A note is written to us, not to the other players: the confirmation says
    // it landed and offers nothing to open.
    expect(screen.getByRole("status")).toHaveTextContent(/thanks for the feedback/i);
    expect(screen.queryByRole("button", { name: /see what everyone/i })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("ignores a whitespace-only note rather than sending an empty event", async () => {
    trackFeedbackSubmitted.mockClear();
    render(
      <InstructionsModal
        open
        onClose={vi.fn()}
      />,
    );
    const box = screen.getByLabelText(/share feedback or leave a suggestion/i);

    await userEvent.type(box, "   ");
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    fireEvent.submit(box.closest("form")!);

    expect(trackFeedbackSubmitted).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/thanks for the feedback/i),
    ).not.toBeInTheDocument();
  });

  it("keeps Standard to a line, with More info opening the fold explainer and closing back to the sheet", async () => {
    clock.today = MODE_CHOICE_START;
    try {
      const onClose = vi.fn();
      render(<InstructionsModal open onClose={onClose} />);

      await userEvent.click(
        screen.getByRole("button", { name: /more info on how common forms/i }),
      );
      expect(
        screen.getByRole("dialog", { name: /common forms/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: /how to play/i })).toBeNull();
      expect(screen.getByText(/plurals, tenses and participles/i)).toBeInTheDocument();

      // Escape backs out of the explainer only, not the whole sheet.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(
        screen.getByRole("dialog", { name: /how to play word ?ink/i }),
      ).toBeInTheDocument();
      // Back where the player left, in the same sheet rather than a new one.
      expect(
        screen.getByRole("button", { name: /more info on how common forms/i }),
      ).toHaveFocus();
      expect(document.querySelectorAll(".modal-overlay")).toHaveLength(1);

      // The explainer's back button is one step; its close is all the way.
      await userEvent.click(
        screen.getByRole("button", { name: /more info on how common forms/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /back to how to play/i }),
      );
      expect(
        screen.getByRole("dialog", { name: /how to play word ?ink/i }),
      ).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole("button", { name: /more info on how common forms/i }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: /close instructions/i }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      clock.today = null;
    }
  });

  it("lists Standard's common forms from More info even for a Freeform player", async () => {
    clock.today = MODE_CHOICE_START;
    localStorage.clear();
    resetModeCache();
    setMode("freeform");
    try {
      render(<InstructionsModal open onClose={vi.fn()} />);
      await userEvent.click(
        screen.getByRole("button", { name: /more info on how common forms/i }),
      );
      expect(screen.getByText(/plurals, tenses and participles/i)).toBeInTheDocument();
    } finally {
      clock.today = null;
      localStorage.clear();
      resetModeCache();
    }
  });
});
