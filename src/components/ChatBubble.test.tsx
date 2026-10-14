import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as analytics from "../analytics";
import { playChatMessage, playChatNotice } from "../audio/sound";
import { CHAT_PRIVATE_KEY } from "../game/chatNotices";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { handleFor } from "../game/handle";
import { PLAYER_KEY } from "../game/player";
import { setViewedPuzzle } from "../game/viewedPuzzle";
import { CHAT_SEEN_KEY, ChatBubble } from "./ChatBubble";

const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";
/** The puzzle the game is on in these tests: an archive day, so both arrows work. */
const DAY = "2026-10-12";

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

  it("colors a found word's notice by its tier and marks the word and mode by the mode", async () => {
    const standard = "CalmOtter3 found Mythic word abaci (9.62) in standard mode";
    const freeform = "StormyFox47 banked Legend word quokka (9.94) in freeform mode";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            { id: 2, handle: "CalmOtter3", body: standard, at: "2026-10-13T10:00:00Z", kind: "find", word: "abaci", mode: "standard", tier: "Mythic" },
            { id: 3, handle: "StormyFox47", body: freeform, at: "2026-10-13T10:01:00Z", kind: "find", word: "quokka", mode: "freeform", tier: "Legend" },
          ],
        }),
      ),
    );
    const { container } = render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    const mythic = (await screen.findByText("abaci")).closest("li")!;
    expect(mythic).toHaveClass("chat__message--notice", "chat__message--find", "chat__message--mythic");
    expect(mythic.querySelector(".chat__word strong")).toHaveTextContent("abaci");
    expect(mythic.querySelector(".chat__mode strong")).toHaveTextContent("standard");
    expect(mythic.querySelector(".chat__body")).toHaveTextContent(standard);

    const legend = container.querySelector(".chat__message--legend")!;
    expect(legend.querySelectorAll(".chat__word .rainbow-word__letter")).toHaveLength("quokka".length);
    expect(legend.querySelectorAll(".chat__mode .rainbow-word__letter")).toHaveLength("freeform".length);
    expect(legend.querySelector("strong")).toBeNull();
  });

  it("shows this player's private 'earlier' line among the room's messages", async () => {
    const day = todayDateString();
    setViewedPuzzle(day);
    localStorage.setItem(
      CHAT_PRIVATE_KEY,
      JSON.stringify({
        [day]: [
          {
            id: 5,
            handle: handleFor(PLAYER),
            body: "CalmOtter3 discovered abaci earlier in standard mode",
            at: "2026-10-13T10:05:00Z",
            kind: "earlier",
            word: "abaci",
            mode: "standard",
            tier: "Mythic",
          },
        ],
      }),
    );
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("latest")
        ? json({ latest: 4, message: 4, notice: 0 })
        : json({
            messages: [
              { id: 4, handle: "CalmOtter3", body: "hi", at: "2026-10-13T10:00:00Z" },
              { id: 6, handle: "CalmOtter3", body: "later", at: "2026-10-13T10:06:00Z" },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(await screen.findByRole("button", { name: "Open chat, new messages" }));
    await screen.findByText("later");
    const bodies = [...document.querySelectorAll(".chat__message")].map((li) => li.textContent);
    expect(bodies[1]).toContain("CalmOtter3 discovered abaci earlier in standard mode");
    expect(bodies[1]).toContain("Only you can see this");
    expect(bodies[2]).toContain("later");
    // The room's cursor is its own last message, never the private line.
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) ?? "{}")).toEqual({ [day]: 6 }));
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
