import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FreeformFeedbackPage } from "./FreeformFeedbackPage";

const VERDICT = {
  tally: { love: 3, boo: 1 },
  byDate: [
    { date: "2026-09-14", love: 1, boo: 1 },
    { date: "2026-09-15", love: 2, boo: 0 },
  ],
  notes: [
    {
      id: 2,
      text: "  two scores would be better  ",
      at: "2026-09-15T12:00:00Z",
      date: "2026-09-15",
      vote: "love",
    },
    // No vote at all: a note from somebody who never tapped either button.
    { id: 1, text: "rescoring felt fairer", at: "2026-09-14T12:00:00Z", date: null, vote: null },
    // Nothing but whitespace, which the box will not send: noise from an older
    // shape of the event rather than something a player wrote.
    { id: 3, text: "   ", at: "2026-09-14T09:00:00Z", date: null, vote: null },
  ],
};

function stubFetch(body: unknown = VERDICT) {
  const fetchMock = vi.fn(async () => {
    if (body === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.history.pushState(null, "", "/freeform-feedback");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FreeformFeedbackPage", () => {
  it("shows the tally as counts and shares", async () => {
    stubFetch();
    render(<FreeformFeedbackPage />);

    const tally = await screen.findByLabelText("The vote");
    const counts = within(tally)
      .getAllByText(/^\d+$/)
      .map((el) => el.textContent);
    // The day table repeats the same digits, so the sides are read as the pair
    // of counts they are rather than by looking for a "3" anywhere on the page.
    expect(counts.slice(0, 2)).toEqual(["3", "1"]);
    expect(within(tally).getByText("75%")).toBeInTheDocument();
    expect(within(tally).getByText("25%")).toBeInTheDocument();
    // A count of players, said out loud: the tally is the latest vote each, and
    // a reader deciding the trial on it should know that.
    expect(within(tally).getByText(/4 players, latest vote each/)).toBeInTheDocument();
  });

  it("breaks the vote down by the puzzle it was cast on", async () => {
    stubFetch();
    render(<FreeformFeedbackPage />);

    const row = await screen.findByRole("row", { name: /2026-09-15/ });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "0"]);
  });

  it("shows each note with the verdict its writer landed on", async () => {
    stubFetch();
    render(<FreeformFeedbackPage />);

    // Trimmed, and the whitespace-only row is not a note at all.
    expect(await screen.findByText("two scores would be better")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/voted Love it/)).toBeInTheDocument();
    // Never guessed at: a note from somebody who did not vote says so.
    expect(screen.getByText(/no vote/)).toBeInTheDocument();
  });

  it("says so when nobody has voted or written anything", async () => {
    stubFetch({ tally: { love: 0, boo: 0 }, byDate: [], notes: [] });
    render(<FreeformFeedbackPage />);

    // One sentence rather than two: a trial with nothing in it at all is an
    // empty page, and the frame says so. The halves get their own lines only
    // when the other half has something in it.
    expect(await screen.findByText("No votes or notes yet.")).toBeInTheDocument();
  });

  it("distinguishes a failed read from an empty one", async () => {
    stubFetch(null);
    render(<FreeformFeedbackPage />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load this list/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("No votes or notes yet.")).not.toBeInTheDocument();
  });
});
