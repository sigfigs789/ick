import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as analytics from "../analytics";
import { playChatMessage, playChatNotice } from "../audio/sound";
import { reportBankedWord } from "../game/chatNotices";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { handleFor } from "../game/handle";
import { PLAYER_KEY } from "../game/player";
import { setViewedPuzzle } from "../game/viewedPuzzle";
import { CHAT_SEEN_KEY, ChatBubble } from "./ChatBubble";
import { HOLD_MS } from "../hooks/useHold";

const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";
/** The puzzle the game is on in these tests: an archive day, so both arrows work. */
const DAY = "2026-10-12";
const MYTHIC = { word: "abaci", rarity: "Mythic" as const, zipf: 0.5 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  // Here rather than after: a test that ends with the panel open reports its
  // time when the testing library unmounts it, which is after afterEach.
  vi.clearAllMocks();
  localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: PLAYER }));
  setViewedPuzzle(DAY);
});

vi.mock("../analytics", () => ({
  trackChatOpened: vi.fn(),
  trackChatTime: vi.fn(),
  trackChatMessageSent: vi.fn(),
  trackChatMessageBlocked: vi.fn(),
}));

vi.mock("../audio/sound", () => ({
  playChatMessage: vi.fn(),
  playChatNotice: vi.fn(),
}));

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ChatBubble", () => {
  it("reads the game's puzzle's room only once opened, headed by its drop", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("latest")
        ? json({ latest: 1 })
        : json({ messages: [{ id: 1, handle: "CalmOtter3", body: "hello all", at: "2026-09-29T10:00:00Z" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/chat?date=${DAY}&latest=1`));
    expect(fetchMock.mock.calls.every(([url]) => !url.includes("after"))).toBe(true);

    await userEvent.click(await screen.findByRole("button", { name: "Open chat, new messages" }));
    expect(await screen.findByText("hello all")).toBeInTheDocument();
    expect(screen.getByText("CalmOtter3")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent(dropForDate(DAY));
    expect(screen.getByLabelText("Message")).toHaveAttribute(
      "placeholder",
      `Say something as ${handleFor(PLAYER)}…`,
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat?date=${DAY}&after=0`);
  });

  it("opens without focusing the message box, so no keyboard covers the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ messages: [], latest: 0 })));
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));

    expect(screen.getByRole("dialog", { name: "Chat" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Message" })).not.toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("steps back and forward through the puzzles' rooms", async () => {
    const before = addDays(DAY, -1);
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("latest")
        ? json({ latest: 0 })
        : url.includes(`date=${before}`)
          ? json({ messages: [{ id: 1, handle: "A1", body: "older room", at: "2026-10-11T10:00:00Z" }] })
          : json({ messages: [{ id: 2, handle: "B2", body: "this room", at: "2026-10-12T10:00:00Z" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("this room");

    await userEvent.click(screen.getByRole("button", { name: "Previous puzzle's chat" }));
    expect(await screen.findByText("older room")).toBeInTheDocument();
    expect(screen.queryByText("this room")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent(dropForDate(before));

    await userEvent.click(screen.getByRole("button", { name: "Next puzzle's chat" }));
    expect(await screen.findByText("this room")).toBeInTheDocument();
    expect(screen.queryByText("older room")).not.toBeInTheDocument();
  });

  it("puts a room already read straight back, and asks only for what came after", async () => {
    const before = addDays(DAY, -1);
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("latest")
        ? json({ latest: 0 })
        : url.includes(`date=${before}`)
          ? json({ messages: [{ id: 1, handle: "A1", body: "older room", at: "2026-10-11T10:00:00Z" }] })
          : url.includes("after=0")
            ? json({ messages: [{ id: 2, handle: "B2", body: "this room", at: "2026-10-12T10:00:00Z" }] })
            : json({ messages: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("this room");
    await userEvent.click(screen.getByRole("button", { name: "Previous puzzle's chat" }));
    await screen.findByText("older room");

    await userEvent.click(screen.getByRole("button", { name: "Next puzzle's chat" }));
    expect(screen.getByText("this room")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(`/api/chat?date=${DAY}&after=2`),
    );
  });

  it("can't step past today's puzzle or before the first", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ messages: [], latest: 0 })));
    setViewedPuzzle("2026-07-01");
    const { unmount } = render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(screen.getByRole("button", { name: "Previous puzzle's chat" })).toBeDisabled();
    unmount();

    setViewedPuzzle(todayDateString());
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(screen.getByRole("button", { name: "Next puzzle's chat" })).toBeDisabled();
  });

  it("dots a room with messages for a player who has never opened the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ latest: 4 })));
    render(<ChatBubble />);
    expect(await screen.findByRole("button", { name: "Open chat, new messages" })).toBeInTheDocument();
    expect(localStorage.getItem(CHAT_SEEN_KEY)).toBeNull();
  });

  it("dots a new post in a room already read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    let latest = 4;
    vi.stubGlobal("fetch", vi.fn(async () => json({ latest })));
    render(<ChatBubble />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument();

    latest = 5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(await screen.findByRole("button", { name: "Open chat, new messages" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("dots a player's message blue and a room's own notice green", async () => {
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    vi.stubGlobal("fetch", vi.fn(async () => json({ latest: 6, message: 4, notice: 6 })));
    const { container, unmount } = render(<ChatBubble />);
    await screen.findByRole("button", { name: "Open chat, new messages" });
    expect(container.querySelector(".chat__dot")).toHaveClass("chat__dot--notice");
    unmount();

    // A player's message wins over a notice when both are unread.
    vi.stubGlobal("fetch", vi.fn(async () => json({ latest: 6, message: 5, notice: 6 })));
    const second = render(<ChatBubble />);
    await screen.findByRole("button", { name: "Open chat, new messages" });
    expect(second.container.querySelector(".chat__dot")).toHaveClass("chat__dot--message");
  });

  it("chimes for a post that arrives while closed, by who posted it, not for one waiting on arrival", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 2 }));
    let latest = { latest: 4, message: 4, notice: 3 };
    vi.stubGlobal("fetch", vi.fn(async () => json(latest)));
    render(<ChatBubble />);
    await screen.findByRole("button", { name: "Open chat, new messages" });
    expect(playChatMessage).not.toHaveBeenCalled();
    expect(playChatNotice).not.toHaveBeenCalled();

    latest = { latest: 5, message: 4, notice: 5 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(playChatNotice).toHaveBeenCalledTimes(1);
    expect(playChatMessage).not.toHaveBeenCalled();

    latest = { latest: 6, message: 6, notice: 5 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(playChatMessage).toHaveBeenCalledTimes(1);

    // Nothing new, nothing played.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(playChatMessage).toHaveBeenCalledTimes(1);
    expect(playChatNotice).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("dots a notice this player's word earned at once, without waiting for a check or chiming", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    const notice = { id: 5, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "tier" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST" ? json({ ok: true, message: notice }, 201) : json({ latest: 4, message: 4, notice: 0 }),
      ),
    );
    const { container } = render(<ChatBubble />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument();

    reportBankedWord({ date: DAY, isToday: true, word: MYTHIC, playerId: PLAYER });
    await screen.findByRole("button", { name: "Open chat, new messages" });
    expect(container.querySelector(".chat__dot")).toHaveClass("chat__dot--notice");

    // The next check's cached answer has not caught up: the dot stays, and the
    // notice already heard does not chime.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.querySelector(".chat__dot")).toHaveClass("chat__dot--notice");
    expect(playChatNotice).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("puts a notice this player's word earned into the open room at once", async () => {
    const notice = { id: 7, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "tier" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST" ? json({ ok: true, message: notice }, 201) : json({ messages: [] }),
      ),
    );
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("No messages yet. Say hello!");

    reportBankedWord({ date: DAY, isToday: true, word: MYTHIC, playerId: PLAYER });
    const line = (await screen.findByText("my mythic")).closest("li");
    expect(line).toHaveClass("chat__message--notice", "chat__message--tier");
  });

  it("still fetches another player's message that landed just before this player's notice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const theirs = { id: 6, handle: "B2", body: "theirs", at: "2026-10-12T09:59:59Z" };
    const notice = { id: 7, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "tier" };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ ok: true, message: notice }, 201);
      if (url.includes("after=5")) return json({ messages: [theirs, notice] });
      return json({ messages: [{ id: 5, handle: "A1", body: "first", at: "2026-10-12T09:00:00Z" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("first");

    reportBankedWord({ date: DAY, isToday: true, word: MYTHIC, playerId: PLAYER });
    await screen.findByText("my mythic");

    // The notice did not move the poll past message 6.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await screen.findByText("theirs");
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat?date=${DAY}&after=5`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/chat?date=${DAY}&after=7`);
    vi.useRealTimers();
  });

  it("clears the dot once the room is opened", async () => {
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 3 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("latest")
          ? json({ latest: 5 })
          : json({ messages: [{ id: 5, handle: "B2", body: "new one", at: "2026-09-29T10:00:05Z" }] }),
      ),
    );
    render(<ChatBubble />);
    await userEvent.click(await screen.findByRole("button", { name: "Open chat, new messages" }));
    await screen.findByText("new one");
    expect(JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) ?? "{}")).toEqual({ [DAY]: 5 });

    await userEvent.click(screen.getAllByRole("button", { name: "Close chat" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument());
  });

  it("shows a notice as a line of its own, without a handle above it", async () => {
    const body = "CalmOtter3 banked top scoring word abaci (Mythic, 9.62)";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ messages: [{ id: 2, handle: "CalmOtter3", body, at: "2026-10-13T10:00:00Z", kind: "top" }] }),
      ),
    );
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    const line = (await screen.findByText(body)).closest("li");
    expect(line).toHaveClass("chat__message--notice", "chat__message--top");
    expect(screen.queryByText("CalmOtter3", { exact: true })).not.toBeInTheDocument();
  });

  it("sends a message and shows it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(
            { ok: true, message: { id: 2, handle: handleFor(PLAYER), body: "my find", at: "2026-09-29T10:01:00Z" } },
            201,
          )
        : json({ messages: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("No messages yet. Say hello!");

    await userEvent.type(screen.getByLabelText("Message"), "my find{Enter}");
    expect(await screen.findByText("my find")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ playerId: PLAYER, body: "my find", date: DAY });
  });

  it("stops a profane message in the browser", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await userEvent.type(screen.getByLabelText("Message"), "sh1t{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("keep it clean");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("polls while open and appends only new messages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pages = [
      { messages: [{ id: 1, handle: "A1", body: "first", at: "2026-09-29T10:00:00Z" }] },
      { messages: [{ id: 2, handle: "B2", body: "second", at: "2026-09-29T10:00:05Z" }] },
    ];
    const fetchMock = vi.fn(async (url: string) =>
      json(url.includes("latest") ? { latest: 0 } : (pages.shift() ?? { messages: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("first");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/chat?date=${DAY}&after=1`);
    vi.useRealTimers();
  });

  it("reports the view, each send, each block, and the time open on close", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ ok: true, message: { id: 5, handle: handleFor(PLAYER), body: "hey all", at: "2026-09-29T10:01:00Z" } }, 201)
        : json({ messages: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);

    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(analytics.trackChatOpened).toHaveBeenCalledTimes(1);
    const view = vi.mocked(analytics.trackChatOpened).mock.calls[0][0];

    await userEvent.type(screen.getByLabelText("Message"), "hey all{Enter}");
    await screen.findByText("hey all");
    expect(analytics.trackChatMessageSent).toHaveBeenCalledWith(view, 7);

    await userEvent.type(screen.getByLabelText("Message"), "sh1t{Enter}");
    expect(analytics.trackChatMessageBlocked).toHaveBeenCalledWith(view, "profane");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await userEvent.click(screen.getByRole("button", { name: "Close chat", expanded: true }));
    expect(analytics.trackChatTime).toHaveBeenCalledTimes(1);
    const report = vi.mocked(analytics.trackChatTime).mock.calls[0][0];
    expect(report).toMatchObject({ viewId: view, sent: 1, closed: true, reportNumber: 1 });
    expect(report.visibleMs).toBeGreaterThanOrEqual(5000);
    expect(report.segmentMs).toBe(report.visibleMs);
    vi.useRealTimers();
  });
});

describe("ChatBubble reactions", () => {
  const MESSAGE = { id: 5, handle: "CalmOtter3", body: "found quixotic", at: "2026-10-12T10:00:00Z" };

  /** A room of one message, answering reaction posts with `reacted`. */
  function room(reactions: unknown[], reacted: unknown = { ok: true, reactions: [] }, status = 200) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(reacted, status);
      return url.includes("latest") ? json({ latest: 5 }) : json({ messages: [MESSAGE], reactions });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function posted(fetchMock: ReturnType<typeof room>) {
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    return call ? JSON.parse(String(call[1]?.body)) : undefined;
  }

  async function openRoom() {
    render(<ChatBubble />);
    await userEvent.click(await screen.findByRole("button", { name: /Open chat/ }));
    await screen.findByText("found quixotic");
  }

  it("shows each line's reactions, the player's own pressed, and takes one back", async () => {
    const own = handleFor(PLAYER);
    const fetchMock = room(
      [
        { id: 5, emoji: "🔥", handles: ["A1", own] },
        { id: 5, emoji: "👍", handles: ["B2"] },
      ],
      {
        ok: true,
        reactions: [
          { emoji: "🔥", handles: ["A1"] },
          { emoji: "👍", handles: ["B2"] },
        ],
      },
    );
    await openRoom();

    const fire = screen.getByRole("button", { name: "🔥 2, from A1 and you" });
    expect(fire).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "👍 1, from B2" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(fire);
    expect(await screen.findByRole("button", { name: "🔥 1, from A1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(posted(fetchMock)).toEqual({ playerId: PLAYER, date: DAY, react: { id: 5, emoji: "🔥", on: false } });
  });

  it("reacts from the add-reaction button's tray", async () => {
    const own = handleFor(PLAYER);
    const fetchMock = room([], { ok: true, reactions: [{ emoji: "🎉", handles: [own] }] });
    await openRoom();

    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("button", { name: "React 🎉" }));
    expect(await screen.findByRole("button", { name: "🎉 1, from you" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("group", { name: "React" })).not.toBeInTheDocument();
    expect(posted(fetchMock)).toEqual({ playerId: PLAYER, date: DAY, react: { id: 5, emoji: "🎉", on: true } });
  });

  it("opens the tray when a line is held down, and Escape closes only the tray", async () => {
    room([]);
    await openRoom();
    const line = screen.getByText("found quixotic");

    fireEvent.pointerDown(line, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(line);
    expect(screen.queryByRole("group", { name: "React" })).not.toBeInTheDocument();

    fireEvent.pointerDown(line, { button: 0, clientX: 10, clientY: 10 });
    await act(() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50)));
    expect(screen.getByRole("group", { name: "React" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "React" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Chat" })).toBeInTheDocument();
  });

  it("puts a refused reaction back and says why", async () => {
    room([], { ok: false, reason: "full" }, 409);
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("button", { name: "React 🔥" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can't take any more reactions");
    expect(screen.queryByRole("button", { name: /^🔥/ })).not.toBeInTheDocument();
  });

  it("says reactions are not available, not to try again, when the server has none", async () => {
    room([], { ok: false, reason: "not-migrated" }, 503);
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("button", { name: "React 🔥" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reactions aren't available yet.");
    expect(screen.queryByRole("button", { name: /^🔥/ })).not.toBeInTheDocument();
  });

  it("opens the full picker from the tray's +", async () => {
    room([]);
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("button", { name: "More reactions" }));
    expect(screen.getByRole("dialog", { name: "Pick a reaction" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close reactions" }));
    expect(screen.queryByRole("dialog", { name: "Pick a reaction" })).not.toBeInTheDocument();
  });
});
