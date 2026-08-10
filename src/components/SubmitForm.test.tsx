import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubmitForm } from "./SubmitForm";

describe("SubmitForm", () => {
  it("submits the typed word and clears the box", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitForm fragment="str" disabled={false} feedback={null} prefill={null} onSubmit={onSubmit} />
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
      <SubmitForm fragment="str" disabled={false} feedback={null} prefill={null} onSubmit={onSubmit} />
    );

    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    await userEvent.type(input, "   ");
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the input and button once the puzzle is complete", () => {
    render(
      <SubmitForm fragment="str" disabled={true} feedback={null} prefill={null} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByText(/completed this puzzle/i)).toBeInTheDocument();
  });

  it("loads a prefill value into the input and focuses it", () => {
    render(
      <SubmitForm
        fragment="str"
        disabled={false}
        feedback={null}
        prefill={{ word: "strange", token: 1 }}
        onSubmit={vi.fn()}
      />
    );
    const input = screen.getByLabelText(/enter a word containing "STR"/i);
    expect(input).toHaveValue("strange");
    expect(input).toHaveFocus();
  });
});
