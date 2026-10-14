import { afterEach, describe, expect, it, vi } from "vitest";
import { onBankedNotice, reportBankedWord } from "./chatNotices";
import { formatRarityScore } from "./dictionary";

const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";
const WORD = { word: "Abaci", rarity: "Mythic" as const, zipf: 0.5 };

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("hands the notice a word earned straight to the chat, with no wait", async () => {
    const notice = { id: 9, handle: "CalmOtter3", body: "CalmOtter3 banked Mythic word abaci (9.62)", at: "2026-10-13T10:00:00Z", kind: "tier" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, message: notice }), { status: 201 })));
    const heard = vi.fn();
    const off = onBankedNotice(heard);
    reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, playerId: PLAYER });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith("2026-10-13", notice));
    off();
  });

  it("hands nothing on when the word earned no notice", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: null }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const heard = vi.fn();
    const off = onBankedNotice(heard);
    reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, playerId: PLAYER });
    await fetchMock.mock.results[0].value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).not.toHaveBeenCalled();
    off();
  });

  it("sends nothing for an archive day or a player with no id", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(reportBankedWord({ date: "2026-10-01", isToday: false, word: WORD, playerId: PLAYER })).toBe(false);
    expect(reportBankedWord({ date: "2026-10-13", isToday: true, word: WORD, playerId: null })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
