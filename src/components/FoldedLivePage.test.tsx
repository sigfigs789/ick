import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FoldedLivePage } from "./FoldedLivePage";

/**
 * The corpus and the fold trace are stubbed: what is under test is how the page
 * holds up when the live rejections cannot be read, not the fold rules.
 */
vi.mock("../game/corpus", () => ({
  loadCorpus: () => Promise.resolve(true),
}));

vi.mock("../game/foldedRows", () => ({
  foldedRows: () => [
    { word: "timelessly", base: "time", ownZipf: 1.2, baseZipf: 5.4, finders: 2 },
  ],
}));

vi.mock("../game/dictionary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/dictionary")>();
  return { ...actual, usesFreeformRules: () => false };
});

/** The finds feed answers; the rejections answer with `live`. */
function stubFetch(live: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/leaderboard")) {
        return new Response(
          JSON.stringify({ words: [{ word: "timelessly", zipf: 1.2, finders: 2 }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(live.body), { status: live.status });
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("FoldedLivePage", () => {
  it("lists the folds with their rejections", async () => {
    stubFetch({ status: 200, body: { rejections: [] } });
    render(<FoldedLivePage />);
    expect(await screen.findByText("timelessly")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toHaveProperty("disabled", false);
  });

  it("still lists the folds when the rejections table is missing, and says so", async () => {
    stubFetch({ status: 503, body: { ok: false, reason: "not-migrated" } });
    render(<FoldedLivePage />);
    expect(await screen.findByText("timelessly")).toBeTruthy();
    expect(screen.getByText(/supabase db push/)).toBeTruthy();
    expect(screen.queryByText(/Couldn.t load this puzzle\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toHaveProperty("disabled", true);
  });

  it("still lists the folds when the rejections are unreachable", async () => {
    stubFetch({ status: 502, body: { ok: false, reason: "unavailable" } });
    render(<FoldedLivePage />);
    expect(await screen.findByText("timelessly")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/rejections, so they can.t be changed/)).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "Reject" })).toHaveProperty("disabled", true);
  });

  it("puts a puzzle already read straight back on the way back to it", async () => {
    stubFetch({ status: 200, body: { rejections: [] } });
    render(<FoldedLivePage />);
    expect(await screen.findByText("timelessly")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous puzzle" }));
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Next puzzle" }));
    expect(screen.getByText("timelessly")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("opens on the puzzle it showed last time, coming back to the page", async () => {
    stubFetch({ status: 200, body: { rejections: [] } });
    const { unmount } = render(<FoldedLivePage />);
    expect(await screen.findByText("timelessly")).toBeTruthy();
    unmount();

    render(<FoldedLivePage />);
    expect(screen.getByText("timelessly")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
