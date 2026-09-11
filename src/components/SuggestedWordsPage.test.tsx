import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestedWordsPage } from "./SuggestedWordsPage";

const WORDS = [
  {
    word: "blorp",
    origin: "player",
    zipf: null,
    pos: [],
    firstUse: null,
    mwSource: null,
    lookups: 0,
    suggestions: 2,
    lastAt: "2026-09-10T12:00:00Z",
  },
  {
    word: "enshittification",
    origin: "both",
    zipf: 1.42,
    pos: ["noun"],
    firstUse: "2022",
    mwSource: "collegiate",
    lookups: 3,
    suggestions: 1,
    lastAt: "2026-09-10T12:00:00Z",
  },
];

/** Every URL the page asked for, in order, so a test can read the last one. */
const asked: string[] = [];

/** Answer the queue read; `null` makes it fail instead. */
function stubFetch(words: unknown = WORDS) {
  const fetchMock = vi.fn(async (url: string) => {
    asked.push(url);
    if (words === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ words }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  asked.length = 0;
  window.history.pushState(null, "", "/suggested-words");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SuggestedWordsPage", () => {
  it("lists the queue in the order the endpoint returned it", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(screen.getByText("blorp")).toBeInTheDocument());
    const words = screen.getAllByText(/blorp|enshittification/);
    expect(words.map((node) => node.textContent)).toEqual([
      "blorp",
      "enshittification",
    ]);
  });

  it("says a word is unattested rather than leaving its frequency blank", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(screen.getByText("unattested")).toBeInTheDocument());
    expect(screen.getByText("zipf 1.42")).toBeInTheDocument();
  });

  it("names where a candidate came from, and counts only what it has", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(screen.getByText("asked for")).toBeInTheDocument());
    expect(screen.getByText("asked for + played")).toBeInTheDocument();
    expect(screen.getByText("2 suggestions")).toBeInTheDocument();
    expect(screen.getByText("3 lookups")).toBeInTheDocument();
    // The player-only word has no lookups, so the row does not claim zero.
    expect(screen.queryByText("0 lookups")).not.toBeInTheDocument();
  });

  it("tells an empty queue from a failed read", async () => {
    stubFetch([]);
    const { unmount } = render(<SuggestedWordsPage />);
    await waitFor(() =>
      expect(screen.getByText("Nothing in the queue.")).toBeInTheDocument(),
    );
    unmount();
    vi.unstubAllGlobals();

    stubFetch(null);
    render(<SuggestedWordsPage />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("re-reads on retry", async () => {
    const failing = stubFetch(null);
    render(<SuggestedWordsPage />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(failing).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("carries the review key from its own URL, when the deployment wants one", async () => {
    window.history.pushState(null, "", "/suggested-words?key=letmein");
    const fetchMock = stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(asked[0]).toBe("/api/review?list=suggested-words&key=letmein");
  });
});
