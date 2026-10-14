import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_PRIVATE_EVENT, privateNotices, reportBankedWord } from "./chatNotices";
import { formatRarityScore } from "./dictionary";

const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";
const WORD = { word: "Abaci", rarity: "Mythic" as const, zipf: 0.5 };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("reportBankedWord", () => {
  it("reports a live puzzle's word as the game showed it", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, mode: "freeform", playerId: PLAYER })
    ).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(String(init.body))).toEqual({
      playerId: PLAYER,
      banked: {
        date: "2026-10-13",
        mode: "freeform",
        word: "abaci",
        tier: "Mythic",
        score: formatRarityScore(0.5, "2026-10-13"),
      },
    });
  });

  it("sends nothing for an archive day or a player with no id", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(reportBankedWord({ date: "2026-10-01", isToday: false, word: WORD, playerId: PLAYER })).toBe(false);
    expect(reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, playerId: null })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a word under Mythic", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      reportBankedWord({
        date: "2026-10-13",
        isToday: true,
        word: { word: "cat", rarity: "Very Common", zipf: 6 },
        playerId: PLAYER,
      })
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the private line it gets back when somebody found the word first", async () => {
    const earlier = {
      id: 12,
      handle: "StormyFox47",
      body: "CalmOtter3 discovered abaci earlier in standard mode",
      at: "2026-10-13T10:05:00Z",
      kind: "earlier",
      word: "abaci",
      mode: "standard",
      tier: "Mythic",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, message: earlier }), { status: 201 })));
    const heard = vi.fn();
    window.addEventListener(CHAT_PRIVATE_EVENT, heard);
    reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, mode: "standard", playerId: PLAYER });
    await vi.waitFor(() => expect(privateNotices("2026-10-13")).toEqual([earlier]));
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(CHAT_PRIVATE_EVENT, heard);
  });

  it("keeps nothing when its word is the room's notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, message: { id: 3, kind: "find", body: "x", handle: "a", at: "" } }), {
          status: 201,
        })
      )
    );
    reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, playerId: PLAYER });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(privateNotices("2026-10-13")).toEqual([]);
  });
});
