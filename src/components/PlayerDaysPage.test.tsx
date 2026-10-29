import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PlayerDaysPage } from "./PlayerDaysPage";
import { handleFor } from "../game/handle";
import { joinBoard } from "../game/player";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

function stubTotal(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("PlayerDaysPage", () => {
  it("lists players by days played, each with the milestone they have reached", async () => {
    const me = joinBoard()!;
    const fetchMock = stubTotal({
      total: [
        { rank: 1, playerId: ALICE, puzzles: 100, firstPlayed: "2026-05-01", lastPlayed: "2026-08-27" },
        { rank: 2, playerId: BOB, puzzles: 12, firstPlayed: "2026-08-10", lastPlayed: "2026-08-28" },
      ],
      totalSelf: { rank: 1000, playerId: me, puzzles: 1, firstPlayed: "2026-08-28", lastPlayed: "2026-08-28" },
    });
    render(<PlayerDaysPage />);

    const list = await screen.findByRole("list", { name: /Days played/ });
    const rows = within(list)
      .getAllByRole("listitem")
      .filter((row) => !row.classList.contains("leaderboard__gap"));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(handleFor(ALICE));
    expect(rows[0]).toHaveTextContent("💯 100");
    expect(rows[0]).toHaveTextContent("100 days played milestone");
    expect(rows[1]).toHaveTextContent("🌱 12");
    expect(rows[1]).toHaveTextContent("Since Aug 10");
    expect(rows[2]).toHaveTextContent("you");
    expect(rows[2]).not.toHaveTextContent("milestone");
    expect(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0])).toContain(
      "/api/leaderboard?total=1"
    );
  });

  it("says so when nobody has played", async () => {
    stubTotal({ total: [], totalSelf: null });
    render(<PlayerDaysPage />);
    expect(await screen.findByText(/Nobody has played yet/)).toBeInTheDocument();
  });

  it("offers a retry when the board fails to load", async () => {
    stubTotal({ ok: false }, 502);
    render(<PlayerDaysPage />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
