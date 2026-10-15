import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TotalLeaderboardPage } from "./TotalLeaderboardPage";
import { handleFor } from "../game/handle";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

function stubTotal(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TotalLeaderboardPage", () => {
  it("lists players in the order the server ranked them", async () => {
    const fetchMock = stubTotal({
      total: [
        { rank: 1, playerId: ALICE, puzzles: 42, firstPlayed: "2026-07-01", lastPlayed: "2026-10-15" },
        { rank: 2, playerId: BOB, puzzles: 7, firstPlayed: "2026-10-01", lastPlayed: "2026-10-14" },
      ],
      totalSelf: null,
    });
    render(<TotalLeaderboardPage />);

    const list = await screen.findByRole("list", { name: /Puzzles played/ });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(handleFor(ALICE));
    expect(rows[0]).toHaveTextContent("42");
    expect(rows[1]).toHaveTextContent(handleFor(BOB));
    expect(rows[1]).toHaveTextContent("7 puzzles played");
    expect(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0])).toContain(
      "/api/leaderboard?total=1"
    );
  });

  it("says so when nobody has played", async () => {
    stubTotal({ total: [], totalSelf: null });
    render(<TotalLeaderboardPage />);
    expect(await screen.findByText("Nobody has played yet.")).toBeInTheDocument();
  });

  it("offers a retry when the board fails to load", async () => {
    stubTotal({ ok: false }, 502);
    render(<TotalLeaderboardPage />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
