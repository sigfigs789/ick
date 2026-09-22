import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransferPage } from "./TransferPage";
import { handleFor } from "../game/handle";
import { collectTransfer, encodeTransfer, type TransferPayload } from "../game/transfer";

const MINE = "11111111-2222-4333-8444-555555555555";
const THEIRS = "99999999-8888-4777-8666-555555555555";

function day(date: string) {
  return JSON.stringify({
    date,
    drop: "cr",
    acceptedWords: [{ word: "crumpet", rarity: "Rare", zipf: 2.1 }],
    rejectedAttempts: [],
    completed: false,
  });
}

/** Put a player in this browser, the way a played day would have. */
function seed(id: string, dates: string[] = []) {
  localStorage.setItem("ick:player", JSON.stringify({ id }));
  for (const date of dates) localStorage.setItem(`ick:progress:${date}`, day(date));
}

/** An encoded payload for `id`, built the way the sending browser builds one. */
async function linkFor(id: string, dates: string[]): Promise<string> {
  const before = localStorage.getItem("ick:player");
  localStorage.clear();
  seed(id, dates);
  const encoded = await encodeTransfer(collectTransfer() as TransferPayload);
  localStorage.clear();
  if (before) localStorage.setItem("ick:player", before);
  return encoded;
}

function setHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  localStorage.clear();
  setHash("");
});

describe("the browser being left", () => {
  it("names the player before building anything", () => {
    seed(MINE, ["2026-09-18"]);

    render(<TransferPage />);

    expect(screen.getByText(handleFor(MINE))).toBeInTheDocument();
    // The id field is always there; the link is what must not be, until asked.
    expect(screen.queryByRole("textbox", { name: /transfer link/i }))
      .not.toBeInTheDocument();
  });

  it("warns that the link is the identity, before it exists", () => {
    seed(MINE);

    render(<TransferPage />);

    expect(screen.getByText(/anyone who opens the link becomes this player/i))
      .toBeInTheDocument();
  });

  it("builds a link only when asked", async () => {
    seed(MINE, ["2026-09-18"]);

    render(<TransferPage />);
    await userEvent.click(screen.getByRole("button", { name: /build transfer link/i }));

    const box = await screen.findByRole("textbox", { name: /transfer link/i });
    expect((box as HTMLTextAreaElement).value).toContain("/transfer#");
  });

  it("has nothing to offer a browser that has never played", () => {
    render(<TransferPage />);

    expect(screen.getByText(/no player yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build transfer link/i }))
      .not.toBeInTheDocument();
  });
});

describe("becoming a player by id", () => {
  it("shows the handle the id resolves to before doing anything", async () => {
    seed(MINE);

    render(<TransferPage />);
    await userEvent.type(screen.getByLabelText(/player id/i), THEIRS);
    await userEvent.click(screen.getByRole("button", { name: /check this id/i }));

    // The handle is the proofreading step: a mistyped character gives a name
    // the reader will not recognise.
    expect(screen.getByText(handleFor(THEIRS))).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ick:player") ?? "{}").id).toBe(MINE);
  });

  it("adopts the player on the second press", async () => {
    seed(MINE);
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, replace },
      writable: true,
    });

    render(<TransferPage />);
    await userEvent.type(screen.getByLabelText(/player id/i), THEIRS);
    await userEvent.click(screen.getByRole("button", { name: /check this id/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, become/i }));

    expect(JSON.parse(localStorage.getItem("ick:player") ?? "{}").id).toBe(THEIRS);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("leaves whatever this browser already had", async () => {
    seed(MINE, ["2026-09-01"]);
    Object.defineProperty(window, "location", {
      value: { ...window.location, replace: vi.fn() },
      writable: true,
    });

    render(<TransferPage />);
    await userEvent.type(screen.getByLabelText(/player id/i), THEIRS);
    await userEvent.click(screen.getByRole("button", { name: /check this id/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, become/i }));

    expect(localStorage.getItem("ick:progress:2026-09-01")).toBe(day("2026-09-01"));
  });

  it("says so when what was typed is not an id", async () => {
    seed(MINE);

    render(<TransferPage />);
    await userEvent.type(screen.getByLabelText(/player id/i), "NorthernBear87");
    await userEvent.click(screen.getByRole("button", { name: /check this id/i }));

    expect(screen.getByText(/isn.t a player id/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes, become/i })).not.toBeInTheDocument();
  });

  it("has nothing to do when the id is the one already here", async () => {
    seed(MINE);

    render(<TransferPage />);
    await userEvent.type(screen.getByLabelText(/player id/i), MINE);
    await userEvent.click(screen.getByRole("button", { name: /check this id/i }));

    // "is already", not "already": the section's own heading opens with the
    // word, and matching that would pass without the page having said anything.
    expect(screen.getByText(/is already/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes, become/i })).not.toBeInTheDocument();
  });
});

describe("the browser arriving", () => {
  it("names both players and waits", async () => {
    seed(MINE);
    setHash(await linkFor(THEIRS, ["2026-09-18", "2026-09-19"]));
    seed(MINE);

    render(<TransferPage />);

    expect(
      await screen.findByRole("heading", {
        name: new RegExp(`become ${handleFor(THEIRS)}`, "i"),
      })
    ).toBeInTheDocument();
    // Twice over: the handle being replaced, and the warning that it stays on
    // the board regardless.
    expect(screen.getAllByText(handleFor(MINE), { exact: false }).length)
      .toBeGreaterThan(0);
    // Nothing has moved: the page asked, it did not act.
    expect(JSON.parse(localStorage.getItem("ick:player") ?? "{}").id).toBe(MINE);
    expect(localStorage.getItem("ick:progress:2026-09-18")).toBeNull();
  });

  it("says how much is coming", async () => {
    setHash(await linkFor(THEIRS, ["2026-09-18", "2026-09-19"]));

    render(<TransferPage />);

    expect(await screen.findByText(/2 days of play, 2026-09-18 to 2026-09-19/i))
      .toBeInTheDocument();
  });

  it("adopts the player when told to", async () => {
    setHash(await linkFor(THEIRS, ["2026-09-18"]));
    seed(MINE);
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, replace, hash: window.location.hash },
      writable: true,
    });

    render(<TransferPage />);
    await userEvent.click(await screen.findByRole("button", { name: /yes, become/i }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("ick:player") ?? "{}").id).toBe(THEIRS);
    });
    expect(localStorage.getItem("ick:progress:2026-09-18")).toBe(day("2026-09-18"));
    // Left on `/` rather than back here, so the hash -- a live credential --
    // does not stay in this browser's history.
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("says so when the link did not survive the trip", async () => {
    const encoded = await linkFor(THEIRS, ["2026-09-18"]);
    setHash(encoded.slice(0, encoded.length - 12));

    render(<TransferPage />);

    expect(await screen.findByText(/didn.t work/i)).toBeInTheDocument();
  });

  it("has nothing to do when this browser is already that player", async () => {
    setHash(await linkFor(THEIRS, ["2026-09-18"]));
    seed(THEIRS);

    render(<TransferPage />);

    expect(await screen.findByText(/already/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes, become/i })).not.toBeInTheDocument();
  });
});
