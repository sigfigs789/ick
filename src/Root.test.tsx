import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "./Root";
import { joinBoard } from "./game/player";

// The pages themselves are not what these tests are about -- Root's job is to
// pick one and to repair the board data on the way in.
vi.mock("./App", () => ({ default: () => <div>game</div> }));
vi.mock("./components/LeaderboardPage", () => ({
  // Opening the leaderboard is the joining (see LeaderboardPage), so the stub
  // does the one part of that Root has to know about.
  LeaderboardPage: () => {
    useEffect(() => {
      joinBoard();
    }, []);
    return <div>leaderboard</div>;
  },
}));

const WORDS = [{ word: "inkling", rarity: "Rare" as const, zipf: 2.6 }];

/** Remember a day this browser played on its own date. */
function played(date: string) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({
      date,
      drop: "ink",
      acceptedWords: WORDS,
      rejectedAttempts: [],
      completed: true,
      firstWordAt: `${date}T20:00:00.000Z`,
      completedAt: `${date}T20:00:00.000Z`,
    })
  );
}

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The days a submission carried. */
function postedDates(fetchMock: ReturnType<typeof stubFetch>): string[] {
  const [, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?];
  const body = JSON.parse(String(init?.body ?? "null")) as { scores?: { date: string }[] };
  return (body.scores ?? []).map((score) => score.date);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keeping the board in step on open", () => {
  it("sends a joined player's history from the game page", () => {
    joinBoard();
    played("2026-08-20");
    played("2026-08-21");
    const fetchMock = stubFetch();

    render(<Root />);

    expect(screen.getByText("game")).toBeInTheDocument();
    // The whole point: a day that never made it up when it was played goes up
    // now, without the player having to open the leaderboard.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedDates(fetchMock)).toEqual(["2026-08-20", "2026-08-21"]);
  });

  it("sends nothing for a browser that has never joined", () => {
    played("2026-08-20");
    const fetchMock = stubFetch();

    render(<Root />);

    // Joining is still the player's own move. Somebody who has never opened the
    // leaderboard is not put on it by opening the game.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the import to the leaderboard when the player joins on this load", () => {
    played("2026-08-20");
    const fetchMock = stubFetch();

    window.history.replaceState(null, "", "/leaderboard");
    render(<Root />);

    expect(screen.getByText("leaderboard")).toBeInTheDocument();
    // The page's own join sends the history; a second identical request behind
    // it would be for nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
