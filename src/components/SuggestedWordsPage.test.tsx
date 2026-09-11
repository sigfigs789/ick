import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    firstAt: "2026-09-08T09:00:00Z",
    lastAt: "2026-09-10T12:00:00Z",
    mark: null,
    // Only ever suggested: nobody played it, so there is no live verdict.
    liveApproved: false,
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
    firstAt: "2026-09-09T09:00:00Z",
    lastAt: "2026-09-10T12:00:00Z",
    mark: "accepted",
    liveApproved: true,
  },
];

/** Every URL the page asked for, in order, so a test can read the last one. */
const asked: string[] = [];

/** Answer the queue read; `null` makes it fail instead. */
/** Every mark the page tried to save, in order. */
const marked: Record<string, unknown>[] = [];

function stubFetch(words: unknown = WORDS) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      marked.push(body);
      return new Response(JSON.stringify({ mark: body.mark }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
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
  marked.length = 0;
  // A curator's URL: the triage controls are drawn only for a reader
  // holding the key the marking endpoint requires.
  window.history.pushState(null, "", "/suggested-words?key=let-me-in");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SuggestedWordsPage", () => {
  it("lists the queue in the order the endpoint returned it -- submission order", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(screen.getByText("blorp")).toBeInTheDocument());
    const words = screen.getAllByText(/blorp|enshittification/);
    expect(words.map((node) => node.textContent)).toEqual([
      "blorp",
      "enshittification",
    ]);
  });

  it("shows what a word would score, not the frequency behind it", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    // The number a player would see. Zipf runs the other way -- higher means
    // more common -- so a queue judged on it was judged backwards.
    await waitFor(() => expect(screen.getByText("9.3")).toBeInTheDocument());
    // An unattested word still has a score, and the row says both: the 10 it
    // would earn, and why nobody should trust it.
    expect(screen.getByText(/^10\.00 · unattested$/)).toBeInTheDocument();
    expect(screen.queryByText(/zipf/)).not.toBeInTheDocument();
  });

  it("names where a candidate came from, and counts only what it has", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(screen.getByText("asked for")).toBeInTheDocument());
    expect(screen.getByText("asked for + played")).toBeInTheDocument();
    expect(screen.getByText("2 suggestions")).toBeInTheDocument();
    // The lookup count is off the row: "played" already says the word was
    // reached in a puzzle, and how many times was not something anybody
    // triaged on. The endpoint still sends it -- enshittification has 3.
    expect(screen.queryByText(/\d+ lookups?$/)).not.toBeInTheDocument();
  });

  it("says which words the live lookup approved on its own", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    // The label sits on the word the live check let through, and on no other:
    // it is the game's own verdict, separate from the triage mark.
    const live = screen.getAllByText("live lookup approved");
    expect(live).toHaveLength(1);
    expect(live[0].closest("li")).toHaveTextContent("enshittification");
  });

  it("shows a reader the mark without offering to change it", async () => {
    // A player's view: the box still says accepted, rejected or neither, which
    // is the answer they came for -- it just is not a button.
    window.history.pushState(null, "", "/suggested-words");
    stubFetch();
    render(<SuggestedWordsPage />);

    await screen.findByText("enshittification");
    const row = within(screen.getByText("enshittification").closest("li") as HTMLElement);
    expect(row.getByRole("img", { name: /enshittification: accepted/i })).toBeInTheDocument();
    expect(
      within(screen.getByText("blorp").closest("li") as HTMLElement).getByRole("img", {
        name: /blorp: not judged yet/i,
      }),
    ).toBeInTheDocument();
  });

  it("names the more common word a queued word's score folds onto", async () => {
    // "reoxygenate" is in the shipped dictionary and caps at "oxygenated", so
    // the row says what it would actually score as. Read from the dictionary
    // here rather than sent by the endpoint: the fold is the game's own rule.
    stubFetch([{ ...WORDS[0], word: "reoxygenate" }]);
    render(<SuggestedWordsPage />);

    await screen.findByText("reoxygenate");
    expect(screen.getByText(/common form oxygenated/)).toBeInTheDocument();
  });

  it("says nothing about a common form for a word the dictionary has never seen", async () => {
    // blorp is not a word, so there is no fold to report and the row does not
    // invent one.
    stubFetch();
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    expect(
      within(screen.getByText("blorp").closest("li") as HTMLElement).queryByText(/common form/),
    ).not.toBeInTheDocument();
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

  it("shows each word's existing mark, and writes a new one against the word", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);
    await screen.findByText("blorp");
    const row = () => within(screen.getByText("blorp").closest("li") as HTMLElement);

    // enshittification arrives already accepted; blorp has never been judged.
    expect(
      within(screen.getByText("enshittification").closest("li") as HTMLElement).getByRole(
        "button",
        { name: /accepted/ },
      ),
    ).toBeInTheDocument();

    await userEvent.click(row().getByRole("button", { name: /unmarked/ }));
    await waitFor(() => expect(marked).toHaveLength(1));
    // The word itself is the reference: a word's mark is its row in the
    // dictionary's own triage column.
    expect(marked[0]).toEqual({ list: "suggested-words", ref: "blorp", mark: "accepted" });
  });

  it("shows a player no triage controls, since the page is linked from the game", async () => {
    // What a player following the link from the word rules sheet gets: the
    // queue, and no accept/reject button -- the endpoint would refuse the mark
    // anyway, and a control that can only fail is worse than no control.
    window.history.pushState(null, "", "/suggested-words");
    stubFetch();
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    expect(screen.queryByRole("button", { name: /unmarked/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accepted/ })).not.toBeInTheDocument();
  });

  it("carries the review key from its own URL, when the deployment wants one", async () => {
    window.history.pushState(null, "", "/suggested-words?key=letmein");
    const fetchMock = stubFetch();
    render(<SuggestedWordsPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(asked[0]).toBe("/api/review?list=suggested-words&key=letmein");
  });
});
