import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as analytics from "../analytics";
import { playChatMessage, playChatNotice } from "../audio/sound";
import { CHAT_PRIVATE_KEY, reportBankedWord } from "../game/chatNotices";
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

  it("closes when the player presses outside it, but not inside it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ messages: [], latest: 0 })));
    render(
      <>
        <button type="button">Elsewhere</button>
        <ChatBubble />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));

    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    expect(screen.getByRole("dialog", { name: "Chat" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
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

  it("pulses the green dot while a Standard find is unread", async () => {
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    const dotFor = async (latest: object) => {
      vi.stubGlobal("fetch", vi.fn(async () => json(latest)));
      const view = render(<ChatBubble />);
      await screen.findByRole("button", { name: "Open chat, new messages" });
      const dot = view.container.querySelector(".chat__dot");
      view.unmount();
      return dot;
    };
    expect(await dotFor({ latest: 6, message: 0, notice: 6, standard: 5 })).toHaveClass(
      "chat__dot--notice",
      "chat__dot--pulse",
    );
    // Read already, it leaves a newer Freeform find a still dot.
    expect(await dotFor({ latest: 6, message: 0, notice: 6, standard: 3 })).not.toHaveClass("chat__dot--pulse");
    // A player's unread message keeps the dot blue and still.
    const blue = await dotFor({ latest: 7, message: 7, notice: 6, standard: 5 });
    expect(blue).toHaveClass("chat__dot--message");
    expect(blue).not.toHaveClass("chat__dot--pulse");
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

  it("dots a notice this player's word earned at once, pulsing for a Standard find, without waiting for a check or chiming", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    const notice = { id: 5, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "find", word: "abaci", mode: "standard", tier: "Mythic" };
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
    expect(container.querySelector(".chat__dot")).toHaveClass("chat__dot--notice", "chat__dot--pulse");

    // The next check's cached answer has not caught up: the dot stays, still
    // pulsing, and the notice already heard does not chime.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.querySelector(".chat__dot")).toHaveClass("chat__dot--notice", "chat__dot--pulse");
    expect(playChatNotice).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("puts a notice this player's word earned into the open room at once", async () => {
    const notice = { id: 7, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "find", word: "abaci", mode: "standard", tier: "Mythic" };
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
    expect(line).toHaveClass("chat__message--notice", "chat__message--mythic");
  });

  it("still fetches another player's message that landed just before this player's notice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const theirs = { id: 6, handle: "B2", body: "theirs", at: "2026-10-12T09:59:59Z" };
    const notice = { id: 7, handle: handleFor(PLAYER), body: "my mythic", at: "2026-10-12T10:00:00Z", kind: "find", word: "abaci", mode: "standard", tier: "Mythic" };
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

  it("marks where the lines new since the room was last read begin", async () => {
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify({ [DAY]: 4 }));
    const line = (id: number, handle: string, body: string) => ({ id, handle, body, at: "2026-10-12T10:00:00Z" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("latest")
          ? json({ latest: 7 })
          : json({
              messages: [
                line(3, "A1", "read one"),
                line(4, "A1", "read two"),
                line(5, handleFor(PLAYER), "mine from elsewhere"),
                line(6, "B2", "unread one"),
                line(7, "B2", "unread two"),
              ],
            }),
      ),
    );
    render(<ChatBubble />);
    await userEvent.click(await screen.findByRole("button", { name: "Open chat, new messages" }));

    const divider = await screen.findByRole("separator", { name: "New messages" });
    expect(divider.nextElementSibling).toHaveTextContent("unread one");
    expect(screen.getAllByRole("separator", { name: "New messages" })).toHaveLength(1);
    // Each unread line is marked; read ones and this player's own are not.
    const isFresh = (text: string) => screen.getByText(text).closest("li")?.classList.contains("chat__message--fresh");
    expect(isFresh("unread one")).toBe(true);
    expect(isFresh("unread two")).toBe(true);
    expect(isFresh("read two")).toBe(false);
    expect(isFresh("mine from elsewhere")).toBe(false);

    // Opened again, it has all been read: no divider.
    await userEvent.click(screen.getAllByRole("button", { name: "Close chat" })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "Open chat" }));
    await screen.findByText("unread two");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/chat?date=${DAY}&after=7`));
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(document.querySelector(".chat__message--fresh")).toBeNull();
  });

  it("marks nothing new in a room never read, nor a line that arrives while it is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let messages = [{ id: 1, handle: "A1", body: "first", at: "2026-10-12T10:00:00Z" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("latest") ? json({ latest: 1 }) : json({ messages }))),
    );
    render(<ChatBubble />);
    await userEvent.click(await screen.findByRole("button", { name: "Open chat, new messages" }));
    await screen.findByText("first");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();

    messages = [{ id: 2, handle: "B2", body: "live one", at: "2026-10-12T10:01:00Z" }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(await screen.findByText("live one")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not count one room's lines as read in the room stepped to", async () => {
    const before = addDays(DAY, -1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("latest")
          ? json({ latest: 0 })
          : url.includes(`date=${before}`)
            ? json({ messages: [{ id: 1, handle: "A1", body: "older room", at: "2026-10-11T10:00:00Z" }] })
            : json({ messages: [{ id: 9, handle: "B2", body: "this room", at: "2026-10-12T10:00:00Z" }] }),
      ),
    );
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("this room");
    await userEvent.click(screen.getByRole("button", { name: "Previous puzzle's chat" }));
    await screen.findByText("older room");
    expect(JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) ?? "{}")).toEqual({ [DAY]: 9, [before]: 1 });
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
    const standard = "CalmOtter3 found abaci 9.62!";
    const freeform = "StormyFox47 banked quokka 9.94!";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          messages: [
            { id: 2, handle: "CalmOtter3", body: standard, at: "2026-10-13T10:00:00Z", kind: "find", word: "abaci", mode: "standard", tier: "Mythic" },
            { id: 3, handle: "StormyFox47", body: freeform, at: "2026-10-13T10:01:00Z", kind: "find", word: "quokka", mode: "freeform", tier: "Legend" },
            { id: 5, handle: "QuietLynx8", body: "QuietLynx8 found Legend word quincunx (9.97) in standard mode", at: "2026-10-13T10:01:30Z", kind: "find", word: "quincunx", mode: "standard", tier: "Legend" },
            { id: 4, handle: "ArcticCanyon34", body: "ArcticCanyon34 banked omphalopsychite 9.99!", at: "2026-10-13T10:02:00Z", kind: "find", word: "omphalopsychite", mode: "standard", tier: "Legend" },
          ],
        }),
      ),
    );
    const { container } = render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    const mythic = (await screen.findByText("abaci")).closest("li")!;
    expect(mythic).toHaveClass("chat__message--notice", "chat__message--find", "chat__message--mythic");
    expect(mythic.querySelector(".chat__word strong")).toHaveTextContent("abaci");
    // The mode is the word's paint, and is said only to screen readers.
    expect(mythic.querySelector(".chat__mode")).toBeNull();
    expect(mythic.querySelector(".chat__body .sr-only:last-child")).toHaveTextContent("in standard mode");
    expect(mythic).toHaveClass("chat__message--standard");
    // Picked by the line's id (2 here), and never Freeform's ✨.
    expect(mythic.querySelector(".chat__notice-icon")).toHaveTextContent("⚡");
    // 💎 is a Standard Legend's at 9.99 or more; under that it rotates
    // like a Mythic (id 5 here).
    const topLegend = (await screen.findByText("omphalopsychite")).closest("li")!;
    expect(topLegend.querySelector(".chat__notice-icon")).toHaveTextContent("💎");
    const legend997 = (await screen.findByText("quincunx")).closest("li")!;
    expect(legend997.querySelector(".chat__notice-icon")).toHaveTextContent("💥");
    // A line posted before the notice was shortened still paints its mode.
    expect(legend997.querySelector(".chat__mode strong")).toHaveTextContent("standard");
    expect(mythic.querySelector(".chat__finder strong")).toHaveTextContent("CalmOtter3");
    expect(mythic.querySelector(".chat__body")).toHaveTextContent(`${standard} in standard mode`);

    const legend = container.querySelector(".chat__message--legend")!;
    expect(legend.querySelectorAll(".chat__word .rainbow-word__letter")).toHaveLength("quokka".length);
    expect(legend.querySelector(".chat__mode")).toBeNull();
    expect(legend).toHaveClass("chat__message--freeform");
    expect(legend.querySelector(".chat__notice-icon")).toHaveTextContent("✨");
    expect(legend.querySelectorAll(".chat__finder .rainbow-word__letter")).toHaveLength("StormyFox47".length);
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
