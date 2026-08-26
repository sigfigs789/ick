import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Root } from "./Root";
import { trackLeaderboardJoined } from "./analytics";
import { joinBoard, loadPlayerId } from "./game/player";

// The pages themselves are not what these tests are about -- Root's job is to
// pick one, to give this browser an identity, and to send what it knows.
vi.mock("./App", () => ({ default: () => <div>game</div> }));
vi.mock("./components/LeaderboardPage", () => ({
  // Records what the id looked like *while the page was rendering*, which is
  // the thing the ordering test needs and nothing else can observe afterwards.
  LeaderboardPage: () => {
    idDuringPageRender = loadPlayerId();
    return <div>leaderboard</div>;
  },
}));
vi.mock("./analytics", () => ({ trackLeaderboardJoined: vi.fn() }));

let idDuringPageRender: string | null = null;

const WORDS = [{ word: "inkling", rarity: "Rare" as const, zipf: 2.6 }];

/** Remember a day this browser played, on its own date unless told otherwise. */
function played(date: string, firstWordAt = `${date}T20:00:00.000Z`) {
  localStorage.setItem(
    `ick:progress:${date}`,
    JSON.stringify({
      date,
      drop: "ink",
      acceptedWords: WORDS,
      rejectedAttempts: [],
      completed: true,
      firstWordAt,
      completedAt: firstWordAt,
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
  idDuringPageRender = null;
  vi.mocked(trackLeaderboardJoined).mockClear();
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
  it("gives a browser an identity and sends its history, from the game page", () => {
    played("2026-08-20");
    played("2026-08-21");
    const fetchMock = stubFetch();

    render(<Root />);

    expect(screen.getByText("game")).toBeInTheDocument();
    // The whole point: a player who has never opened the leaderboard is on the
    // board, and the days they already played are on it with them. Before this,
    // both hung on their having tapped a trophy.
    expect(loadPlayerId()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedDates(fetchMock)).toEqual(["2026-08-20", "2026-08-21"]);
  });

  it("sends only the days this browser can prove were played on their own date", () => {
    played("2026-08-20");
    // Pulled out of the archive weeks later. Off the board here for the same
    // reason it is off the streak: you can look up the answers.
    played("2026-07-04", "2026-08-24T19:00:00.000Z");
    const fetchMock = stubFetch();

    render(<Root />);

    expect(postedDates(fetchMock)).toEqual(["2026-08-20"]);
  });

  it("has the id in place before the leaderboard renders", () => {
    stubFetch();

    window.history.replaceState(null, "", "/leaderboard");
    render(<Root />);

    // Child effects run before a parent's, so a page landed on directly would
    // read the id, find none, and ask for boards without saying who was asking
    // -- no "you" row, no own rank. Minting during Root's render is what puts
    // it there in time, and this is the assertion that holds that in place.
    expect(idDuringPageRender).not.toBeNull();
  });

  it("keeps one identity, and reports the join once", () => {
    played("2026-08-20");
    stubFetch();

    const { unmount } = render(<Root />);
    const first = loadPlayerId();
    expect(trackLeaderboardJoined).toHaveBeenCalledTimes(1);

    unmount();
    render(<Root />);

    // The id is what the handle is computed from, so a second open joining
    // somebody new would rename a player mid-week. And the event marks the
    // browser becoming a player, which happens once -- firing on every open
    // would make it a visit count, which analytics already has.
    expect(loadPlayerId()).toBe(first);
    expect(trackLeaderboardJoined).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when this browser cannot keep an id", () => {
    played("2026-08-20");
    const fetchMock = stubFetch();
    // Private browsing, or storage switched off. There is no way to be on a
    // board without somewhere to keep the id, and that must never be an error:
    // it is a player who plays exactly as before, minus a row.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      render(<Root />);
      expect(screen.getByText("game")).toBeInTheDocument();
      expect(loadPlayerId()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
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
});
