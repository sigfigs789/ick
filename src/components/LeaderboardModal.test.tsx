import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardModal } from "./LeaderboardModal";
import { loadPlayer, savePlayerName } from "../game/player";

const WEEKLY = [
  { playerId: "11111111-1111-4111-8111-111111111111", name: "Ada", score: 41.2, best: 9.9, puzzles: 5 },
  { playerId: "22222222-2222-4222-8222-222222222222", name: "Mo", score: 24.6, best: 9.4, puzzles: 3 },
];
const ALL_TIME = [
  { playerId: "22222222-2222-4222-8222-222222222222", name: "Mo", score: 310.5, best: 10, puzzles: 40 },
  { playerId: "11111111-1111-4111-8111-111111111111", name: "Ada", score: 180, best: 9.9, puzzles: 22 },
];

/** Answer the board fetch; a `null` reply makes the request fail instead. */
function stubFetch(body: unknown = { weekStart: "2026-08-24", weekly: WEEKLY, allTime: ALL_TIME }) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // Score submissions are POSTs and are answered blandly; only the GET matters.
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (body === null) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The rows of one board, by its heading. */
function boardRows(heading: string) {
  const board = screen.getByRole("region", { name: heading });
  return within(board).getAllByRole("listitem");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeaderboardModal", () => {
  it("renders nothing while closed, and asks for no board", () => {
    const fetchMock = stubFetch();
    render(<LeaderboardModal open={false} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows both boards at once, each ranked as the server ordered it", async () => {
    stubFetch();
    render(<LeaderboardModal open onClose={() => {}} />);

    // Both on screen together -- there is no tab to click and no board hidden
    // behind one. This is the whole layout decision, so it is asserted directly.
    await waitFor(() => expect(boardRows("This week")).toHaveLength(2));
    expect(boardRows("This week")[0]).toHaveTextContent("Ada");
    expect(boardRows("This week")[0]).toHaveTextContent("41.2");

    const allTime = boardRows("All time");
    expect(allTime).toHaveLength(2);
    // Different order from the weekly board, which is the point of showing both.
    expect(allTime[0]).toHaveTextContent("Mo");
    expect(allTime[0]).toHaveTextContent("310.5");
  });

  it("counts the puzzles behind each score", async () => {
    stubFetch();
    render(<LeaderboardModal open onClose={() => {}} />);

    await waitFor(() => expect(boardRows("This week")[0]).toHaveTextContent("5 puzzles"));
    expect(boardRows("This week")[1]).toHaveTextContent("3 puzzles");
  });

  it("asks for the week's board from its Monday", async () => {
    const fetchMock = stubFetch();
    render(<LeaderboardModal open onClose={() => {}} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/^\/api\/leaderboard\?since=\d{4}-\d{2}-\d{2}&limit=\d+$/);
    const since = new URL(url, "https://wordink.app").searchParams.get("since") ?? "";
    // A Monday, whatever day the test runs on.
    expect(new Date(`${since}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("marks the player's own row on both boards", async () => {
    savePlayerName("Mo");
    const me = loadPlayer();
    const mine = { ...WEEKLY[1], playerId: me?.id ?? "" };
    stubFetch({
      weekStart: "2026-08-24",
      weekly: [WEEKLY[0], mine],
      allTime: [{ ...ALL_TIME[0], playerId: me?.id ?? "" }, ALL_TIME[1]],
    });
    render(<LeaderboardModal open onClose={() => {}} />);

    await waitFor(() => expect(boardRows("This week")[1]).toHaveTextContent("you"));
    expect(boardRows("All time")[0]).toHaveTextContent("you");
    expect(boardRows("This week")[0]).not.toHaveTextContent("you");
  });

  it("says a board is empty rather than pretending it loaded nothing", async () => {
    stubFetch({ weekStart: "2026-08-24", weekly: [], allTime: [] });
    render(<LeaderboardModal open onClose={() => {}} />);

    expect(await screen.findByText(/Nobody's on the board this week yet/)).toBeInTheDocument();
    expect(screen.getByText("No scores yet.")).toBeInTheDocument();
  });

  it("offers a retry when the board can't be loaded", async () => {
    const fetchMock = stubFetch(null);
    render(<LeaderboardModal open onClose={() => {}} />);

    // One message per board, because each says it for itself.
    const failures = await screen.findAllByText(/Couldn't load\./);
    expect(failures).toHaveLength(2);

    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("joins the board with a typed name and posts the score straight away", async () => {
    stubFetch();
    const onJoin = vi.fn();
    render(<LeaderboardModal open onClose={() => {}} onJoin={onJoin} />);

    await userEvent.type(screen.getByLabelText("Put your name on the board"), "Wordsmith");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(loadPlayer()?.name).toBe("Wordsmith");
    // The app is handed the new player so the puzzle in progress counts, rather
    // than the player waiting for their next word to appear on the board.
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ name: "Wordsmith" }));
    expect(await screen.findByText(/Playing as/)).toHaveTextContent("Wordsmith");
  });

  it("refuses a name too short to be one, without saving anything", async () => {
    stubFetch();
    render(<LeaderboardModal open onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText("Put your name on the board"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(screen.getByText(/two characters or more/)).toBeInTheDocument();
    expect(loadPlayer()).toBeNull();
  });

  it("keeps the same identity across a rename", async () => {
    savePlayerName("Mo");
    const idBefore = loadPlayer()?.id;
    stubFetch();
    render(<LeaderboardModal open onClose={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Change name" }));
    const field = screen.getByLabelText("Change your name");
    await userEvent.clear(field);
    await userEvent.type(field, "Maureen");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // A rename carries the player's whole history rather than starting a second
    // entry on the board.
    expect(loadPlayer()).toEqual({ id: idBefore, name: "Maureen" });
  });

  it("closes on Escape and on the close button", async () => {
    stubFetch();
    const onClose = vi.fn();
    render(<LeaderboardModal open onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Close leaderboard" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
