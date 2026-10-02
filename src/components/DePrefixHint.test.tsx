import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PROGRESS_PREFIX } from "../game/storage";
import { SubmitForm } from "./SubmitForm";

/** A word banked on a puzzle before the cutover: a returning player. */
function playedOn(date: string) {
  localStorage.setItem(
    `${PROGRESS_PREFIX}${date}`,
    JSON.stringify({ date, drop: "ou", acceptedWords: [{ word: "tour" }] })
  );
}

const NOTICE = /as a prefix will now rescore words to their common form/i;

function renderForm(date: string, mode: "standard" | "freeform" = "standard") {
  render(
    <SubmitForm
      drop="ou"
      disabled={false}
      feedback={null}
      onSubmit={() => undefined}
      date={date}
      mode={mode}
    />
  );
  return screen.getByLabelText(/enter a word containing "OU"/i);
}

describe("DePrefixHint", () => {
  // A returning player who has put FoldHint away: one still due it gets that
  // instead (see FoldHint.test).
  beforeEach(() => {
    localStorage.clear();
    playedOn("2026-10-01");
    localStorage.setItem("ick:fold-hint", "1");
  });

  it("appears once a Standard player starts a word with de, from 2026-10-04", async () => {
    const input = renderForm("2026-10-04");
    await userEvent.type(input, "d");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.type(input, "e");
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    // Gone again when the word stops opening that way.
    await userEvent.clear(input);
    await userEvent.type(input, "detour");
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "tour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away before the cutover", async () => {
    const before = renderForm("2026-10-03");
    await userEvent.type(before, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("stays away in Freeform, which folds nothing", async () => {
    const input = renderForm("2026-10-04", "freeform");
    await userEvent.type(input, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("opens the Common forms explainer, with de- in its prefix list", async () => {
    const input = renderForm("2026-10-04");
    await userEvent.type(input, "de");
    await userEvent.click(screen.getByRole("button", { name: /more info/i }));
    expect(screen.getByRole("dialog", { name: /common forms/i })).toBeInTheDocument();
    expect(screen.getByText("de-", { exact: false })).toBeInTheDocument();
  });

  it("stands down for a player still due the common-form notice", async () => {
    localStorage.removeItem("ick:fold-hint");
    const input = renderForm("2026-10-04");
    await userEvent.type(input, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("does not come back once dismissed", async () => {
    const input = renderForm("2026-10-04");
    await userEvent.type(input, "de");
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("is for returning players only: a new one never sees it", async () => {
    localStorage.clear();
    const input = renderForm("2026-10-04");
    await userEvent.type(input, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("does not count a word banked on or after the cutover as returning", async () => {
    localStorage.clear();
    playedOn("2026-10-04");
    const input = renderForm("2026-10-05");
    await userEvent.type(input, "detour");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
