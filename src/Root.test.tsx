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

/** The days the nth submission carried. */
function postedDates(fetchMock: ReturnType<typeof stubFetch>, call = 0): string[] {
  const [, init] = (fetchMock.mock.calls[call] ?? []) as [string?, RequestInit?];
  const body = JSON.parse(String(init?.body ?? "null")) as { scores?: { date: string }[] };
  return (body.scores ?? []).map((score) => score.date);
}

/** Leave the tab for `ms`, then come back to it. */
function away(ms: number) {
  visibility("hidden");
  vi.setSystemTime(Date.now() + ms);
  visibility("visible");
}

function visibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  // A return is measured against the clock, so the tests need to hold it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  visibility("visible");
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

  it("re-sends on returning to a tab that has been away", () => {
    joinBoard();
    played("2026-08-20");
    const fetchMock = stubFetch();

    render(<Root />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A phone put down and picked up again: no reload, no remount, so the mount
    // effect above is the only thing that would ever have run.
    away(6 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(postedDates(fetchMock, 1)).toEqual(["2026-08-20"]);
  });

  it("does not re-send on a glance at another tab and back", () => {
    joinBoard();
    played("2026-08-20");
    const fetchMock = stubFetch();

    render(<Root />);

    // Not an absence. Without the threshold this would be a POST per tab flick.
    away(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-sends when the tab is restored from the back/forward cache", () => {
    joinBoard();
    played("2026-08-20");
    const fetchMock = stubFetch();

    render(<Root />);

    // A bfcache restore runs no effect and remounts nothing, so it needs its
    // own event.
    vi.setSystemTime(Date.now() + 6 * 60_000);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still sends nothing on a return for a browser that has never joined", () => {
    played("2026-08-20");
    const fetchMock = stubFetch();

    render(<Root />);
    away(6 * 60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a player who joins mid-session in step from then on", () => {
    played("2026-08-20");
    const fetchMock = stubFetch();

    // Joining happens on the leaderboard, during this same load.
    window.history.replaceState(null, "", "/leaderboard");
    render(<Root />);
    expect(fetchMock).not.toHaveBeenCalled();

    // Whether this browser has joined is re-read on every return, not fixed at
    // mount, so the repair starts covering them.
    away(6 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
