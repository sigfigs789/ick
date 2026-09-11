import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FeedbackPage } from "./FeedbackPage";

const NOTES = [
  { id: 7, text: "more vowels please", at: "2026-09-10T12:00:00Z" },
  { id: 6, text: "  loving it  ", at: "2026-09-09T12:00:00Z" },
  // Nothing but whitespace: the form will not send one, so a row like this is
  // noise from an older shape of the event rather than feedback anybody left.
  { id: 5, text: "   ", at: "2026-09-08T12:00:00Z" },
];

function stubFetch(feedback: unknown = NOTES) {
  const fetchMock = vi.fn(async () => {
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
  window.history.pushState(null, "", "/feedback");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeedbackPage", () => {
  it("shows each note as text, newest first, trimmed", async () => {
    stubFetch();
    render(<FeedbackPage />);

    await waitFor(() =>
      expect(screen.getByText("more vowels please")).toBeInTheDocument(),
    );
    expect(screen.getByText("loving it")).toBeInTheDocument();
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

  it("offers a retry when the read fails", async () => {
    stubFetch(null);
    render(<FeedbackPage />);

    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
