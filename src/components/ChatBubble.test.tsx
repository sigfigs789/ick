import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFor } from "../game/handle";
import { PLAYER_KEY } from "../game/player";
import { ChatBubble } from "./ChatBubble";

const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: PLAYER }));
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ChatBubble", () => {
  it("reads nothing until opened, then shows the room", async () => {
    const fetchMock = vi.fn(async () =>
      json({ messages: [{ id: 1, handle: "CalmOtter3", body: "hello all", at: "2026-09-29T10:00:00Z" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(await screen.findByText("hello all")).toBeInTheDocument();
    expect(screen.getByText("CalmOtter3")).toBeInTheDocument();
    expect(screen.getByText(`You're ${handleFor(PLAYER)}`)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/chat?after=0");
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
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ playerId: PLAYER, body: "my find" });
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
    const fetchMock = vi.fn(async () => json(pages.shift() ?? { messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatBubble />);
    await userEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await screen.findByText("first");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chat?after=1");
    vi.useRealTimers();
  });
});
