import { afterEach, describe, expect, it, vi } from "vitest";
import { noticeVerb } from "../src/game/chat";
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
  it("reads one puzzle's room after the given id, without player ids", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { id: "7", handle: "StormyFox47", body: "hi", created_at: "2026-09-29T10:00:00Z" },
    ]);
    const response = await handler(
      new Request("https://wordink.app/api/chat?date=2026-09-29&after=6"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=2");
    expect(await response.json()).toEqual({
      messages: [{ id: 7, handle: "StormyFox47", body: "hi", at: "2026-09-29T10:00:00Z" }],
    });
    const call = rpcCall(fetchMock);
    expect(call.url).toContain("/rpc/chat_recent");
    expect(call.args).toEqual({ p_date: "2026-09-29", p_after: 6, p_limit: 50 });
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
    expect(await response.json()).toEqual({ latest: 12 });
    expect(rpcCall(fetchMock).args).toEqual({ p_date: "2026-09-29", p_after: 0, p_limit: 1 });
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
    expect(await response.json()).toEqual({ latest: 0 });
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

  it("hands both notice lines to the database and returns the one it posted", async () => {
    withEnv();
    const handle = handleFor(PLAYER);
    const verb = noticeVerb(handle, "abaci");
    const fetchMock = stubFetch([
      {
        status: "top",
        id: 9,
        handle,
        body: `${handle} ${verb} top scoring word abaci (Mythic, 9.62)`,
        kind: "top",
        created_at: "2026-10-13T10:00:00Z",
      },
    ]);
    const response = await handler(banked());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      message: {
        id: 9,
        handle,
        body: `${handle} ${verb} top scoring word abaci (Mythic, 9.62)`,
        at: "2026-10-13T10:00:00Z",
        kind: "top",
      },
    });
    const call = rpcCall(fetchMock);
    expect(call.url).toContain("/rpc/chat_bank");
    expect(call.args).toEqual({
      p_player: PLAYER,
      p_handle: handle,
      p_date: today,
      p_mode: "standard",
      p_word: "abaci",
      p_score: 9.62,
      p_top_body: `${handle} ${verb} top scoring word abaci (Mythic, 9.62)`,
      p_tier_body: `${handle} ${verb} Mythic word abaci (9.62)`,
    });
  });

  it("sends no tier line for a word under 9.5, and answers 202 when nothing is posted", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { status: "none", id: null, handle: null, body: null, kind: null, created_at: null },
    ]);
    const response = await handler(banked({ word: "cat", tier: "Very Common", score: "0.4" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: null });
    expect(rpcCall(fetchMock).args.p_tier_body).toBeNull();
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
