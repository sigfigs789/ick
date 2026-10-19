import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { typedFoldAffix } from "../game/foldHint";
import { SubmitForm } from "./SubmitForm";

const NOTICE = /score as their more common form/i;

function renderForm(date = "2026-10-04", mode: "standard" | "freeform" = "standard") {
  render(
    <SubmitForm
      drop="rve"
      disabled={false}
      feedback={null}
      onSubmit={() => undefined}
      date={date}
      mode={mode}
    />
  );
  return screen.getByLabelText(/enter a word containing "RVE"/i);
}

/** A played puzzle, as storage counts one: a progress record with a word in it. */
function playPuzzle(date: string) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({ date, acceptedWords: [{ word: "deserve" }] })
  );
}

describe("typedFoldAffix", () => {
  it("catches a prefix the moment it is typed", () => {
    expect(typedFoldAffix("ove", "2026-10-04", "standard")).toBeUndefined();
    expect(typedFoldAffix("over", "2026-10-04", "standard")).toBe("over-");
    expect(typedFoldAffix("overpl", "2026-10-04", "standard")).toBe("over-");
  });

  it("catches a longer suffix once there is a stem in front of it, longest first", () => {
    expect(typedFoldAffix("less", "2026-10-04", "standard")).toBeUndefined();
    expect(typedFoldAffix("kindness", "2026-10-04", "standard")).toBe("-ness");
    expect(typedFoldAffix("happiest", "2026-10-04", "standard")).toBe("-iest");
    expect(typedFoldAffix("readability", "2026-10-04", "standard")).toBe("-ability");
  });

  it("leaves the short suffixes alone", () => {
    for (const word of ["curves", "curved", "curving", "curvy", "nervely", "server", "sparsest"]) {
      expect(typedFoldAffix(word, "2026-10-04", "standard")).toBeUndefined();
    }
  });

  it("keeps the prefix it caught first, rather than whatever the word ends in so far", () => {
    expect(typedFoldAffix("overkind", "2026-10-04", "standard")).toBe("over-");
    expect(typedFoldAffix("overkindness", "2026-10-04", "standard")).toBe("over-");
  });

  it("never names de-, which opens far more words than it builds", () => {
    for (const word of ["de", "deser", "deservedly", "dechunked"]) {
      expect(typedFoldAffix(word, "2026-10-04", "standard")).toBeUndefined();
    }
  });

  it("finds nothing in Freeform, which folds nothing", () => {
    expect(typedFoldAffix("overkindness", "2026-10-04", "freeform")).toBeUndefined();
  });

  it("only names an affix that folded on that puzzle", () => {
    // "-less" folds from 2026-09-02 (PRIVATIVE_BASE_START).
    expect(typedFoldAffix("penniless", "2026-08-01", "standard")).toBeUndefined();
  });
});

describe("FoldHint", () => {
  beforeEach(() => localStorage.clear());

  it("shows a new Standard player the affix as they type it", async () => {
    const input = renderForm();
    await userEvent.type(input, "ove");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.type(input, "rpl");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Words starting with “over-” score as their more common form."
    );
    await userEvent.clear(input);
    await userEvent.type(input, "kindness");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Words ending in “-ness” score as their more common form."
    );
  });

  it("says nothing while no affix is in the box", async () => {
    const input = renderForm();
    await userEvent.type(input, "curve");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "deservedly");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away in Freeform", async () => {
    const input = renderForm("2026-10-04", "freeform");
    await userEvent.type(input, "overkindness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away once a player has played three puzzles", async () => {
    playPuzzle("2026-10-01");
    playPuzzle("2026-10-02");
    playPuzzle("2026-10-03");
    const input = renderForm();
    await userEvent.type(input, "overkindness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("opens the Common forms explainer, without pointing at Freeform", async () => {
    const input = renderForm();
    await userEvent.type(input, "over");
    await userEvent.click(screen.getByRole("button", { name: /more info/i }));
    const dialog = screen.getByRole("dialog", { name: /common forms/i });
    expect(dialog).toHaveTextContent("over-");
    expect(dialog).not.toHaveTextContent(/freeform/i);
  });

  it("does not come back once dismissed", async () => {
    const input = renderForm();
    await userEvent.type(input, "over");
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.type(input, "kindness");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
