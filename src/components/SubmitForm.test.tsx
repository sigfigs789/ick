import { render, screen } from "@testing-library/react";
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

  it("disables the input and button once the puzzle is complete", () => {
    render(
      <SubmitForm drop="str" disabled={true} feedback={null} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByText(/completed this puzzle/i)).toBeInTheDocument();
  });
});
