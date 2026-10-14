import { afterEach, describe, expect, it, vi } from "vitest";
import { earlierNoticeBody, noticeVerb } from "../src/game/chat";
import { handleFor } from "../src/game/handle";
import handler from "./chat";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const PLAYER = "0b3c6c1e-1d0a-4c55-9b5e-2f3a4b5c6d7e";

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

function stubFetch(reply: unknown = [], status = 200) {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify(reply), { status: 200 })
      : new Response("boom", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rpcCall(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, args: JSON.parse(String(init.body)) as Record<string, unknown> };
}

/** Answer each RPC by name; one with no answer here fails. */
function stubRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const name = url.split("/rpc/")[1];
    return name in routes
      ? new Response(JSON.stringify(routes[name]), { status: 200 })
      : new Response("boom", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rpcArgs(fetchMock: ReturnType<typeof vi.fn>, name: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/rpc/${name}`));
  if (!call) throw new Error(`${name} was not called`);
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

function post(body: unknown, origin?: string): Request {
  return new Request("https://wordink.app/api/chat", {
    method: "POST",
    headers: origin ? { origin } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/chat GET", () => {
  it("reads one puzzle's room after the given id, and its reactions, without player ids", async () => {
    withEnv();
    const fetchMock = stubRoutes({
      chat_recent: [{ id: "7", handle: "StormyFox47", body: "hi", created_at: "2026-09-29T10:00:00Z" }],
      chat_room_reactions: [
        { message_id: "3", emoji: "🔥", handles: ["CalmOtter3", "StormyFox47"] },
        { message_id: 7, emoji: "👍", handles: ["CalmOtter3"] },
      ],
    });
    const response = await handler(
      new Request("https://wordink.app/api/chat?date=2026-09-29&after=6"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=2");
    expect(await response.json()).toEqual({
      messages: [{ id: 7, handle: "StormyFox47", body: "hi", at: "2026-09-29T10:00:00Z" }],
      reactions: [
        { id: 3, emoji: "🔥", handles: ["CalmOtter3", "StormyFox47"] },
        { id: 7, emoji: "👍", handles: ["CalmOtter3"] },
      ],
    });
    expect(rpcArgs(fetchMock, "chat_recent")).toEqual({ p_date: "2026-09-29", p_after: 6, p_limit: 50 });
    expect(rpcArgs(fetchMock, "chat_room_reactions")).toEqual({ p_date: "2026-09-29" });
  });

  it("still answers the room when its reactions cannot be read", async () => {
    withEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubRoutes({
      chat_recent: [{ id: "7", handle: "StormyFox47", body: "hi", created_at: "2026-09-29T10:00:00Z" }],
    });
    const response = await handler(
      new Request("https://wordink.app/api/chat?date=2026-09-29&after=6"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messages: [{ id: 7, handle: "StormyFox47", body: "hi", at: "2026-09-29T10:00:00Z" }],
    });
  });

  it("answers just the newest id for ?latest", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { id: "12", handle: "StormyFox47", body: "hi", created_at: "2026-09-29T10:00:00Z" },
    ]);
    const response = await handler(
      new Request("https://wordink.app/api/chat?date=2026-09-29&latest=1"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(await response.json()).toEqual({ latest: 12, message: 12, notice: 0 });
    expect(rpcCall(fetchMock).args).toEqual({ p_date: "2026-09-29", p_after: 0, p_limit: 50 });
  });

  it("splits ?latest into the newest player's message and the newest notice", async () => {
    withEnv();
    stubFetch([
      { id: "10", handle: "StormyFox47", body: "hi", created_at: "2026-09-29T10:00:00Z", kind: "message" },
      { id: "11", handle: "StormyFox47", body: "banked", created_at: "2026-09-29T10:01:00Z", kind: "top" },
      { id: "12", handle: "CalmOtter3", body: "nice", created_at: "2026-09-29T10:02:00Z", kind: "message" },
      { id: "13", handle: "CalmOtter3", body: "banked", created_at: "2026-09-29T10:03:00Z", kind: "tier" },
    ]);
    const response = await handler(
      new Request("https://wordink.app/api/chat?date=2026-09-29&latest=1"),
    );
    expect(await response.json()).toEqual({ latest: 13, message: 12, notice: 13 });
  });

  it("gives a request that names no puzzle today's room on Mountain Time", async () => {
    withEnv();
    vi.useFakeTimers({ toFake: ["Date"] });
    // 03:00 UTC on the 14th is still the 13th in Denver.
    vi.setSystemTime(new Date("2026-10-14T03:00:00Z"));
    const fetchMock = stubFetch([]);
    await handler(new Request("https://wordink.app/api/chat?after=0"));
    vi.useRealTimers();
    expect(rpcCall(fetchMock).args.p_date).toBe("2026-10-13");
  });

  it("refuses a date with no puzzle", async () => {
    withEnv();
    const fetchMock = stubFetch();
    for (const date of ["2026-06-30", "2099-01-01", "yesterday", "2026-13-45"]) {
      const response = await handler(new Request(`https://wordink.app/api/chat?date=${date}`));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers latest 0 for an empty room", async () => {
    withEnv();
    stubFetch([]);
    const response = await handler(new Request("https://wordink.app/api/chat?latest=1"));
    expect(await response.json()).toEqual({ latest: 0, message: 0, notice: 0 });
  });

  it("refuses a malformed cursor", async () => {
    withEnv();
    stubFetch();
    const response = await handler(new Request("https://wordink.app/api/chat?after=abc"));
    expect(response.status).toBe(400);
  });

  it("says so when the database fails", async () => {
    withEnv();
    stubFetch(null, 500);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler(new Request("https://wordink.app/api/chat"));
    expect(response.status).toBe(502);
  });

  it("answers 503 without credentials", async () => {
    withEnv({});
    const response = await handler(new Request("https://wordink.app/api/chat"));
    expect(response.status).toBe(503);
  });
});

describe("api/chat POST", () => {
  it("posts under the handle computed from the id", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { status: "ok", id: 8, handle: handleFor(PLAYER), body: "found it", created_at: "2026-09-29T10:01:00Z" },
    ]);
    const response = await handler(
      post({ playerId: PLAYER, body: "  found \n it ", date: "2026-09-29" }),
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as { message: Record<string, unknown> };
    expect(data.message).toEqual({
      id: 8,
      handle: handleFor(PLAYER),
      body: "found it",
      at: "2026-09-29T10:01:00Z",
    });
    expect(JSON.stringify(data)).not.toContain(PLAYER);
    const call = rpcCall(fetchMock);
    expect(call.url).toContain("/rpc/chat_post");
    expect(call.args).toEqual({
      p_player: PLAYER,
      p_handle: handleFor(PLAYER),
      p_body: "found it",
      p_date: "2026-09-29",
    });
  });

  it("refuses profanity before touching the database", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(post({ playerId: PLAYER, body: "oh sh1t" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, reason: "profane" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the database's rate limit through as 429", async () => {
    withEnv();
    stubFetch([{ status: "rate-limited", id: null, handle: null, body: null, created_at: null }]);
    const response = await handler(post({ playerId: PLAYER, body: "again" }));
    expect(response.status).toBe(429);
  });

  it("refuses bad players, empty bodies and junk", async () => {
    withEnv();
    stubFetch();
    expect((await handler(post({ playerId: "no spaces", body: "hi" }))).status).toBe(400);
    expect((await handler(post({ playerId: PLAYER, body: 5 }))).status).toBe(400);
    expect((await handler(post({ playerId: PLAYER, body: "   " }))).status).toBe(422);
    expect((await handler(post("not json"))).status).toBe(400);
    expect((await handler(post({ playerId: PLAYER, body: "hi", date: "2026-06-30" }))).status).toBe(400);
  });

  it("refuses cross-origin posts", async () => {
    withEnv();
    stubFetch();
    const response = await handler(post({ playerId: PLAYER, body: "hi" }, "https://evil.example"));
    expect(response.status).toBe(403);
  });

  it("rejects other methods", async () => {
    const response = await handler(new Request("https://wordink.app/api/chat", { method: "DELETE" }));
    expect(response.status).toBe(405);
  });
});

describe("api/chat POST banked", () => {
  const today = new Date().toISOString().slice(0, 10);
  const banked = (overrides: Record<string, unknown> = {}) =>
    post({
      playerId: PLAYER,
      banked: { date: today, mode: "standard", word: "abaci", tier: "Mythic", score: "9.62", ...overrides },
    });

  it("hands both notice lines to the database and returns the room's notice", async () => {
    withEnv();
    const handle = handleFor(PLAYER);
    const verb = noticeVerb(handle, "abaci");
    const body = `${handle} ${verb} Mythic word abaci (9.62) in standard mode`;
    const fetchMock = stubFetch([
      {
        status: "find",
        id: 9,
        handle,
        body,
        kind: "find",
        created_at: "2026-10-13T10:00:00Z",
        word: "abaci",
        mode: "standard",
        tier: "Mythic",
      },
    ]);
    const response = await handler(banked());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      message: {
        id: 9,
        handle,
        body,
        at: "2026-10-13T10:00:00Z",
        kind: "find",
        word: "abaci",
        mode: "standard",
        tier: "Mythic",
      },
    });
    const call = rpcCall(fetchMock);
    expect(call.url).toContain("/rpc/chat_find");
    expect(call.args).toEqual({
      p_player: PLAYER,
      p_handle: handle,
      p_date: today,
      p_mode: "standard",
      p_word: "abaci",
      p_tier: "Mythic",
      p_score: 9.62,
      p_find_body: body,
      p_earlier_body: earlierNoticeBody(handle, {
        date: today, mode: "standard", word: "abaci", tier: "Mythic", score: "9.62",
      }),
    });
  });

  it("returns the private line when somebody banked the word first", async () => {
    withEnv();
    const handle = handleFor(PLAYER);
    stubFetch([
      {
        status: "earlier",
        id: 10,
        handle,
        body: "CalmOtter3 discovered abaci earlier in freeform mode",
        kind: "earlier",
        created_at: "2026-10-13T10:05:00Z",
        word: "abaci",
        mode: "freeform",
        tier: "Mythic",
      },
    ]);
    const response = await handler(banked({ mode: "freeform" }));
    expect(response.status).toBe(201);
    expect((await response.json()).message).toMatchObject({
      id: 10,
      kind: "earlier",
      body: "CalmOtter3 discovered abaci earlier in freeform mode",
      mode: "freeform",
    });
  });

  it("answers 202 when the player already reported the word", async () => {
    withEnv();
    stubFetch([{ status: "duplicate", id: null }]);
    const response = await handler(banked());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: null });
  });

  it("does not ask the database about a word under 9.5", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(banked({ word: "cat", tier: "Very Common", score: "0.4" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an archive day, a bad tier and a malformed score before touching the database", async () => {
    withEnv();
    const fetchMock = stubFetch();
    expect((await handler(banked({ date: "2026-07-01" }))).status).toBe(400);
    expect((await handler(banked({ tier: "Godlike" }))).status).toBe(400);
    expect((await handler(banked({ score: "11" }))).status).toBe(400);
    expect((await handler(banked({ score: 9.6 }))).status).toBe(400);
    expect((await handler(banked({ word: "Abaci" }))).status).toBe(400);
    expect((await handler(banked({ mode: "hard" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("api/chat POST react", () => {
  const react = (overrides: Record<string, unknown> = {}, date: unknown = "2026-09-29") =>
    post({ playerId: PLAYER, date, react: { id: 7, emoji: "🔥", on: true, ...overrides } });

  it("puts the reaction under the handle and answers the line's reactions", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { status: "ok", emoji: "🔥", handles: ["CalmOtter3", handleFor(PLAYER)] },
      { status: "ok", emoji: "👍🏽", handles: [handleFor(PLAYER)] },
    ]);
    const response = await handler(react());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      ok: true,
      reactions: [
        { emoji: "🔥", handles: ["CalmOtter3", handleFor(PLAYER)] },
        { emoji: "👍🏽", handles: [handleFor(PLAYER)] },
      ],
    });
    expect(JSON.stringify(data)).not.toContain(PLAYER);
    const call = rpcCall(fetchMock);
    expect(call.url).toContain("/rpc/chat_react");
    expect(call.args).toEqual({
      p_player: PLAYER,
      p_handle: handleFor(PLAYER),
      p_date: "2026-09-29",
      p_message: 7,
      p_emoji: "🔥",
      p_on: true,
    });
  });

  it("answers an empty list when the last reaction is taken back", async () => {
    withEnv();
    stubFetch([{ status: "ok", emoji: null, handles: null }]);
    const response = await handler(react({ on: false }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reactions: [] });
  });

  it("passes the database's refusals through", async () => {
    withEnv();
    stubFetch([{ status: "missing", emoji: null, handles: null }]);
    expect((await handler(react())).status).toBe(404);
    stubFetch([{ status: "full", emoji: null, handles: null }]);
    const full = await handler(react());
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ ok: false, reason: "full" });
    stubFetch([{ status: "rate-limited", emoji: null, handles: null }]);
    expect((await handler(react())).status).toBe(429);
  });

  it("refuses text, a bad line and a bad room before touching the database", async () => {
    withEnv();
    const fetchMock = stubFetch();
    expect((await handler(react({ emoji: "lol" }))).status).toBe(400);
    expect((await handler(react({ emoji: "👍👍" }))).status).toBe(400);
    expect((await handler(react({ emoji: "" }))).status).toBe(400);
    expect((await handler(react({ id: "7" }))).status).toBe(400);
    expect((await handler(react({ id: 0 }))).status).toBe(400);
    expect((await handler(react({ on: "yes" }))).status).toBe(400);
    expect((await handler(react({}, "2026-06-30"))).status).toBe(400);
    expect((await handler(post({ playerId: PLAYER, react: "🔥" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
