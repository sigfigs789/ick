import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackPage } from "./FeedbackPage";

const NOTES = [
  { id: 6, text: "  loving it  ", at: "2026-09-09T12:00:00Z", mark: "accepted" },
  { id: 7, text: "more vowels please", at: "2026-09-10T12:00:00Z", mark: null },
  // Nothing but whitespace: the form will not send one, so a row like this is
  // noise from an older shape of the event rather than feedback anybody left.
  { id: 5, text: "   ", at: "2026-09-08T12:00:00Z" },
];

/** Every mark this page tried to save, in order. */
const marked: Record<string, unknown>[] = [];

function stubFetch(feedback: unknown = NOTES, markOk = true) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      marked.push(body);
      if (!markOk) return new Response("nope", { status: 502 });
      return new Response(JSON.stringify({ mark: body.mark }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (feedback === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ feedback }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  marked.length = 0;
  // A curator's URL: the triage controls are drawn only for a reader
  // holding the key the marking endpoint requires.
  window.history.pushState(null, "", "/feedback?key=let-me-in");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeedbackPage", () => {
  it("shows each note as text, in the order the endpoint returned it, trimmed", async () => {
    stubFetch();
    render(<FeedbackPage />);

    await waitFor(() =>
      expect(screen.getByText("more vowels please")).toBeInTheDocument(),
    );
    expect(screen.getByText("loving it")).toBeInTheDocument();
    // Newest first is the list function's doing (see the 2026-09-11 ordering
    // migration), so what this page owes it is not to re-sort: rows come out in
    // the order they came in, whatever that order turns out to be.
    expect(
      screen.getAllByText(/loving it|more vowels please/).map((node) => node.textContent),
    ).toEqual(["loving it", "more vowels please"]);
  });

  it("drops a note with nothing in it", async () => {
    stubFetch();
    render(<FeedbackPage />);

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("says so when nobody has left anything", async () => {
    stubFetch([]);
    render(<FeedbackPage />);

    await waitFor(() => expect(screen.getByText("No feedback yet.")).toBeInTheDocument());
  });

  it("shows the mark each note already carries", async () => {
    stubFetch();
    render(<FeedbackPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /accepted\. Next click/ })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /unmarked\. Next click marks it accepted/ }),
    ).toBeInTheDocument();
  });

  it("cycles a note through accepted, rejected and back to nothing, saving each", async () => {
    stubFetch();
    render(<FeedbackPage />);
    await screen.findByText("more vowels please");
    // Scoped to one note's row: the other note is marked too, and a state like
    // "accepted" is not unique on the page.
    const row = () =>
      within(screen.getByText("more vowels please").closest("li") as HTMLElement);

    await userEvent.click(row().getByRole("button", { name: /unmarked/ }));
    await waitFor(() => expect(marked).toHaveLength(1));
    expect(marked[0]).toEqual({ list: "feedback", ref: 7, mark: "accepted" });
    await waitFor(() =>
      expect(
        row().getByRole("button", { name: /accepted\. Next click marks it rejected/ }),
      ).toBeInTheDocument(),
    );

    await userEvent.click(row().getByRole("button", { name: /Next click marks it rejected/ }));
    await waitFor(() => expect(marked).toHaveLength(2));
    expect(marked[1]).toEqual({ list: "feedback", ref: 7, mark: "rejected" });

    await userEvent.click(row().getByRole("button", { name: /Next click clears the mark/ }));
    await waitFor(() => expect(marked).toHaveLength(3));
    expect(marked[2]).toEqual({ list: "feedback", ref: 7, mark: null });
    await waitFor(() =>
      expect(row().getByRole("button", { name: /unmarked/ })).toBeInTheDocument(),
    );
  });

  it("puts a mark back when the save fails, and says so", async () => {
    stubFetch(NOTES, false);
    render(<FeedbackPage />);
    await screen.findByText("more vowels please");
    const row = () =>
      within(screen.getByText("more vowels please").closest("li") as HTMLElement);

    await userEvent.click(row().getByRole("button", { name: /unmarked/ }));

    expect(await screen.findByText(/couldn.t save that mark/i)).toBeInTheDocument();
    // Back where it was: a tick over a row nothing was saved for would make the
    // list a record of clicks rather than of decisions.
    expect(row().getByRole("button", { name: /unmarked/ })).toBeInTheDocument();
  });

  it("marks a note without a key, on a page nothing links to", async () => {
    // No REVIEW_TOKEN, no ?key=, and the triage still works: nothing links
    // here, and a note's mark reaches no part of the game. A deployment that
    // sets a token gets the strict version for free -- the read needs the key,
    // so there is no page to click on without one.
    window.history.pushState(null, "", "/feedback");
    stubFetch();
    render(<FeedbackPage />);

    await screen.findByText("more vowels please");
    const row = () =>
      within(screen.getByText("more vowels please").closest("li") as HTMLElement);
    await userEvent.click(row().getByRole("button", { name: /unmarked/ }));

    await waitFor(() => expect(marked).toHaveLength(1));
    expect(marked[0]).toEqual({ list: "feedback", ref: 7, mark: "accepted" });
  });

  it("offers a retry when the read fails", async () => {
    stubFetch(null);
    render(<FeedbackPage />);

    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
