import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FoldReviewPage } from "./FoldReviewPage";
import type { FoldCandidate } from "../game/foldCandidates";

/**
 * The scan and the corpus are stubbed, and only those two.
 *
 * Working the folds out for real means a 3.6MB download and a third of a second
 * over 225,000 words, and what it would prove here -- that the fold rules fold
 * -- is pinned at length by inflection-scoring.test.ts. What is worth testing on
 * this page is the queue: which rows it draws, what a click stores, and what
 * "next batch" means. So the batching helpers below stay real.
 */
vi.mock("../game/corpus", () => ({ loadCorpus: () => Promise.resolve(true) }));

vi.mock("../game/foldCandidates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/foldCandidates")>();
  return {
    ...actual,
    upcomingFoldDates: () => dates,
    foldCandidates: () => candidates,
    // The real batching, cut to two rows so a fixture of four spans three
    // batches: overriding the exported FOLD_BATCH_SIZE would not do it, since
    // the default argument inside the module reads its own binding.
    foldBatch: (c: FoldCandidate[], done: ReadonlySet<string>) => actual.foldBatch(c, done, 2),
  };
});

let dates = ["2026-09-27", "2026-09-28"];
let candidates: FoldCandidate[] = [];

function fold(word: string, base: string, drop: number): FoldCandidate {
  return {
    word,
    base,
    ownZipf: 1.2,
    baseZipf: 5.4,
    ownScore: "10.00",
    foldedScore: (10 - drop).toFixed(2),
    ownRarity: "Legend",
    foldedRarity: "Common",
    drop,
    date: "2026-09-27",
    letters: "TI",
  };
}

/** Every verdict the page tried to store, in order. */
const stored: Record<string, unknown>[] = [];

function stubFetch(reviews: unknown = [], writeOk = true) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      stored.push(body);
      if (!writeOk) return new Response("nope", { status: 502 });
      return new Response(JSON.stringify({ verdict: body.verdict }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (reviews === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify({ reviews }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  stored.length = 0;
  dates = ["2026-09-27", "2026-09-28"];
  candidates = [
    fold("timelinesses", "time", 7.5),
    fold("untimeliest", "time", 7.4),
    fold("knowinger", "know", 7.2),
    fold("yakows", "yakow", 0),
  ];
  // A curator's URL: the page is blank without the key its endpoint requires.
  window.history.pushState(null, "", "/fold?key=let-me-in");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FoldReviewPage", () => {
  it("shows the fold, both scores and what it cost", async () => {
    stubFetch();
    render(<FoldReviewPage />);

    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());
    expect(screen.getAllByText("time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10.00 Legend").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.50 Common").length).toBeGreaterThan(0);
    expect(screen.getByText("−7.50")).toBeInTheDocument();
  });

  it("hands over one batch at a time", async () => {
    stubFetch();
    render(<FoldReviewPage />);

    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());
    expect(screen.getByText("untimeliest")).toBeInTheDocument();
    expect(screen.queryByText("knowinger")).not.toBeInTheDocument();
  });

  it("stores the whole fold behind an approval, not just the word", async () => {
    stubFetch();
    render(<FoldReviewPage />);
    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: /Approve folding timelinesses to time/ })
    );

    await waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0]).toEqual({
      word: "timelinesses",
      base: "time",
      ownZipf: 1.2,
      baseZipf: 5.4,
      date: "2026-09-27",
      verdict: "approved",
    });
  });

  it("takes an answer back when the same button is pressed again", async () => {
    stubFetch();
    render(<FoldReviewPage />);
    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());

    const reject = screen.getByRole("button", { name: /Reject folding timelinesses to time/ });
    await userEvent.click(reject);
    await waitFor(() => expect(reject).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(reject);

    await waitFor(() => expect(reject).toHaveAttribute("aria-pressed", "false"));
    expect(stored.map((v) => v.verdict)).toEqual(["rejected", null]);
  });

  it("puts the answer back and says so when the write fails", async () => {
    stubFetch([], false);
    render(<FoldReviewPage />);
    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());

    const approve = screen.getByRole("button", { name: /Approve folding timelinesses to time/ });
    await userEvent.click(approve);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(approve).toHaveAttribute("aria-pressed", "false");
  });

  it("leaves out the folds already in the ledger", async () => {
    stubFetch([
      {
        word: "timelinesses",
        base: "time",
        ownZipf: 1.2,
        baseZipf: 5.4,
        verdict: "rejected",
        date: "2026-09-27",
        at: "2026-09-22T09:00:00Z",
      },
    ]);
    render(<FoldReviewPage />);

    await waitFor(() => expect(screen.getByText("untimeliest")).toBeInTheDocument());
    expect(screen.queryByText("timelinesses")).not.toBeInTheDocument();
    expect(screen.getByText("knowinger")).toBeInTheDocument();
  });

  it("skips nothing when a fully answered batch is followed by the next", async () => {
    stubFetch();
    render(<FoldReviewPage />);
    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());

    // Answer both rows, then ask for more: the two that move up into their
    // places have to be the next two, not the two after them.
    await userEvent.click(
      screen.getByRole("button", { name: /Approve folding timelinesses to time/ })
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Approve folding untimeliest to time/ })
    );
    await waitFor(() => expect(stored).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Next batch" }));

    await waitFor(() => expect(screen.getByText("knowinger")).toBeInTheDocument());
    expect(screen.getByText("yakows")).toBeInTheDocument();
  });

  it("puts an unanswered batch aside rather than showing it again", async () => {
    stubFetch();
    render(<FoldReviewPage />);
    await waitFor(() => expect(screen.getByText("timelinesses")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Next batch" }));

    await waitFor(() => expect(screen.getByText("knowinger")).toBeInTheDocument());
    expect(screen.queryByText("timelinesses")).not.toBeInTheDocument();
  });

  it("says the queue needs a key rather than drawing an empty one", async () => {
    window.history.pushState(null, "", "/fold");
    const fetchMock = stubFetch();
    render(<FoldReviewPage />);

    expect(await screen.findByText(/needs a review key/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says there is nothing to fold rather than drawing an empty queue", async () => {
    // Freeform scores every word on its own frequency, so no puzzle ahead folds.
    dates = [];
    stubFetch();
    render(<FoldReviewPage />);

    expect(await screen.findByText(/No folding puzzles ahead/)).toBeInTheDocument();
  });

  it("admits it when the ledger cannot be read", async () => {
    stubFetch(null);
    render(<FoldReviewPage />);

    expect(await screen.findByText(/Couldn.t load this list/)).toBeInTheDocument();
  });
});
