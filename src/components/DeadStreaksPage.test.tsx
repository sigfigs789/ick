import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DeadStreaksPage } from "./DeadStreaksPage";
import { handleFor } from "../game/handle";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

function stubDeadStreaks(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeadStreaksPage", () => {
  it("lists lost streaks in the order the server ranked them", async () => {
    const fetchMock = stubDeadStreaks({
      deadStreaks: [
        { rank: 1, playerId: ALICE, lost: 3, best: 12, lastPlayed: "2026-09-01", days: 20 },
        { rank: 2, playerId: BOB, lost: 5, best: 5, lastPlayed: "2026-09-10", days: 6 },
      ],
    });
    render(<DeadStreaksPage />);

    const list = await screen.findByRole("list", { name: /Dead streaks/ });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(handleFor(ALICE));
    expect(rows[0]).toHaveTextContent("12");
    expect(rows[0]).toHaveTextContent("Lost 3");
    expect(rows[0]).toHaveTextContent("20 days played");
    expect(rows[1]).toHaveTextContent(handleFor(BOB));
    expect(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0])).toContain("/api/leaderboard?dead=1&today=");
  });

  it("says so when nobody has lost a streak", async () => {
    stubDeadStreaks({ deadStreaks: [] });
    render(<DeadStreaksPage />);
    expect(await screen.findByText("No dead streaks yet.")).toBeInTheDocument();
  });

  it("offers a retry when the board fails to load", async () => {
    stubDeadStreaks({ ok: false }, 502);
    render(<DeadStreaksPage />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
