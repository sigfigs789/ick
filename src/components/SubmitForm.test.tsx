import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubmitForm } from "./SubmitForm";

describe("SubmitForm", () => {
  it("submits the typed word and clears the box", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitForm drop="str" disabled={false} feedback={null} onSubmit={onSubmit} />
    );

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "strange");
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith("strange");
    expect(input).toHaveValue("");
  });

  it("does not submit an empty or whitespace-only value", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitForm drop="str" disabled={false} feedback={null} onSubmit={onSubmit} />
    );

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "   ");
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks the row while a live lookup is running, without blocking typing", async () => {
    const { container, rerender } = render(
      <SubmitForm drop="str" disabled={false} feedback={null} checking={true} onSubmit={vi.fn()} />
    );

    expect(container.querySelector(".submit-form__row--checking")).toBeInTheDocument();
    // The wait is indicated, not enforced -- the next word can be typed while
    // the lookup runs.
    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    expect(input).not.toBeDisabled();
    await userEvent.type(input, "stray");
    expect(input).toHaveValue("stray");

    // A lookup that answers mid-sweep leaves the line running: it stops at the
    // end of the pass it is in, not halfway across.
    rerender(
      <SubmitForm drop="str" disabled={false} feedback={null} checking={false} onSubmit={vi.fn()} />
    );
    const field = container.querySelector(".submit-form__field")!;
    expect(container.querySelector(".submit-form__row--checking")).toBeInTheDocument();

    fireEvent.animationIteration(field);
    expect(container.querySelector(".submit-form__row--checking")).not.toBeInTheDocument();
  });

  it("stops the sweep on its own if no animation event ever arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container, rerender } = render(
        <SubmitForm drop="str" disabled={false} feedback={null} checking={true} onSubmit={vi.fn()} />
      );
      rerender(
        <SubmitForm drop="str" disabled={false} feedback={null} checking={false} onSubmit={vi.fn()} />
      );
      expect(container.querySelector(".submit-form__row--checking")).toBeInTheDocument();

      // A backgrounded tab pauses animations, so neither iteration nor end fires.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(container.querySelector(".submit-form__row--checking")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables the input and button once the puzzle is complete", () => {
    render(
      <SubmitForm drop="str" disabled={true} feedback={null} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByText(/completed this puzzle/i)).toBeInTheDocument();
  });
});
