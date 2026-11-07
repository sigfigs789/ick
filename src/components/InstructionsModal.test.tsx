import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODE_CHOICE_START, resetModeCache, setMode } from "../game/mode";
import { InstructionsModal } from "./InstructionsModal";

vi.mock("../analytics", () => ({}));

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

  it("no longer carries the feedback box, which has its own sheet", () => {
    render(<InstructionsModal open onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/share feedback/i)).not.toBeInTheDocument();
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
