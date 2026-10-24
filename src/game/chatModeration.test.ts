import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_BLOCKED_KEY,
  blockHandle,
  blockedHandles,
  canModerate,
  markReported,
  moderated,
  reportLine,
  reportedLines,
  unblockAll,
} from "./chatModeration";

const line = (id: number, handle: string, kind?: string) => ({ id, handle, kind });

beforeEach(() => {
  localStorage.clear();
  unblockAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat moderation", () => {
  it("only offers other players' messages, never notices or the player's own", () => {
    expect(canModerate(line(1, "StormyFox47"), "QuietOwl12")).toBe(true);
    expect(canModerate(line(1, "QuietOwl12"), "QuietOwl12")).toBe(false);
    expect(canModerate(line(1, "StormyFox47", "find"), "QuietOwl12")).toBe(false);
  });

  it("leaves out a blocked handle's messages but keeps notices naming it", () => {
    blockHandle("StormyFox47");
    expect(JSON.parse(localStorage.getItem(CHAT_BLOCKED_KEY)!)).toEqual(["StormyFox47"]);
    const room = [line(1, "StormyFox47"), line(2, "StormyFox47", "find"), line(3, "QuietOwl12")];
    expect(moderated(room).map((l) => l.id)).toEqual([2, 3]);
    unblockAll();
    expect(blockedHandles().size).toBe(0);
    expect(moderated(room)).toHaveLength(3);
  });

  it("leaves out a reported line", () => {
    markReported(3);
    expect(reportedLines().has(3)).toBe(true);
    expect(moderated([line(3, "QuietOwl12"), line(4, "QuietOwl12")]).map((l) => l.id)).toEqual([4]);
  });

  it("hides a reported line even when the report does not send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));
    expect(await reportLine("player", "2026-10-24", 9)).toBe("unavailable");
    expect(reportedLines().has(9)).toBe(true);
  });

  it("sends the line and room to the endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await reportLine("player", "2026-10-24", 9)).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(String(init.body))).toEqual({ playerId: "player", date: "2026-10-24", report: { id: 9 } });
  });
});
