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
    // An unattested word would earn a perfect 10, and the row does not say so:
    // that number is the floor rather than a measurement, and printing it would
    // put the least known words at the top of the queue.
    expect(screen.getByText("TBD")).toBeInTheDocument();
    expect(screen.queryByText(/10\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/zipf/)).not.toBeInTheDocument();
  });

  it("says a door once, not once per label", async () => {
    stubFetch();
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    // The count carries the asked-for fact on its own: "asked for" beside "2
    // suggestions" was the same thing said twice.
    expect(screen.getByText("2 suggestions")).toBeInTheDocument();
    expect(screen.queryByText(/asked for/)).not.toBeInTheDocument();
    // One suggestion reads as the door, not as a tally of one.
    expect(screen.queryByText("1 suggestion")).not.toBeInTheDocument();
    // The lookup count is off the row too: how many times a word was reached
    // was not something anybody triaged on. The endpoint still sends it.
    expect(screen.queryByText(/\d+ lookups?$/)).not.toBeInTheDocument();
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

  it("reads a word that came through both doors as played", async () => {
    // Played is the stronger evidence: somebody reached for the word mid-puzzle
    // and a dictionary backed them up, where a suggestion is a word somebody
    // thought of.
    stubFetch([{ ...WORDS[0], word: "blorp", suggestions: 3, liveApproved: true }]);
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    const row = within(screen.getByText("blorp").closest("li") as HTMLElement);
    expect(row.getByText("played")).toBeInTheDocument();
    expect(row.queryByText(/suggest/)).not.toBeInTheDocument();
  });

  it("says one door when a word came through one", async () => {
    stubFetch([
      { ...WORDS[0], word: "blorp", suggestions: 2, liveApproved: false },
      { ...WORDS[1], word: "susurrus", suggestions: 0, liveApproved: true },
      { ...WORDS[1], word: "caprylate", suggestions: 0, liveApproved: false },
    ]);
    render(<SuggestedWordsPage />);

    await screen.findByText("blorp");
    // Asked for twice and never played: the count says a second person wanted
    // it, and nothing claims it reached a puzzle.
    const asked = within(screen.getByText("blorp").closest("li") as HTMLElement);
    expect(asked.getByText("2 suggestions")).toBeInTheDocument();
    expect(asked.queryByText("played")).not.toBeInTheDocument();
    // Never asked for: the live check is the only reason it is here, so the
    // row says "played" and claims no suggestion.
    const played = within(screen.getByText("susurrus").closest("li") as HTMLElement);
    expect(played.getByText("played")).toBeInTheDocument();
    expect(played.queryByText("suggested")).not.toBeInTheDocument();
    // Neither a live verdict nor a countable event -- a row a review pass
    // seeded. Same label as any other suggestion, because that is what it is.
    expect(
      within(screen.getByText("caprylate").closest("li") as HTMLElement).getByText("suggested"),
    ).toBeInTheDocument();
  });

  it("names the fault when a word has a reviewed rejection on file", async () => {
    // Both are in the shipped rejection ledger: absconce as not-a-word, dremel
    // as a proper noun (a brand name).
    stubFetch([
      { ...WORDS[0], word: "absconce" },
      { ...WORDS[0], word: "dremel" },
    ]);
    render(<SuggestedWordsPage />);

    await screen.findByText("absconce");
    expect(screen.getByText("Not a word")).toBeInTheDocument();
    expect(screen.getByText("Proper noun")).toBeInTheDocument();
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
