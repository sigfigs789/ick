import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SubmitForm } from "./SubmitForm";

const NOTICE = /its more common form/i;

function renderForm(date = "2026-10-04", mode: "standard" | "freeform" = "standard") {
  render(
    <SubmitForm
      drop="ness"
      disabled={false}
      feedback={null}
      onSubmit={() => undefined}
      date={date}
      mode={mode}
    />
  );
  return screen.getByLabelText(/enter a word containing "NESS"/i);
}

/** A played puzzle, as storage counts one: a progress record with a word in it. */
function playPuzzle(date: string) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({ date, acceptedWords: [{ word: "kindness" }] })
  );
}

describe("FoldHint", () => {
  beforeEach(() => localStorage.clear());

  it("tells a new Standard player the word in the box will score as its common form", async () => {
    const input = renderForm();
    await userEvent.type(input, "kindnes");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.type(input, "s");
    expect(screen.getByRole("status")).toHaveTextContent(
      "“kindness” will score as “kind”, its more common form."
    );
  });

  it("says nothing for a word that scores as itself", async () => {
    const input = renderForm();
    await userEvent.type(input, "ness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away in Freeform, which folds nothing", async () => {
    const input = renderForm("2026-10-04", "freeform");
    await userEvent.type(input, "kindness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away once a player has played three puzzles", async () => {
    playPuzzle("2026-10-01");
    playPuzzle("2026-10-02");
    playPuzzle("2026-10-03");
    const input = renderForm();
    await userEvent.type(input, "kindness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("opens the Common forms explainer for the word, without pointing at Freeform", async () => {
    const input = renderForm();
    await userEvent.type(input, "kindness");
    await userEvent.click(screen.getByRole("button", { name: /more info/i }));
    const dialog = screen.getByRole("dialog", { name: /common forms/i });
    expect(dialog).toHaveTextContent("“kindness” scores as “kind”, its more common form.");
    expect(dialog).not.toHaveTextContent(/freeform/i);
  });

  it("does not come back once dismissed", async () => {
    const input = renderForm();
    await userEvent.type(input, "kindness");
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "darkness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
