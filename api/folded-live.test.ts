import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./folded-live";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

function stubFetch(reply: unknown) {
  const fetchMock = vi.fn(async () => {
    if (typeof reply === "number") return new Response("boom", { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, args: JSON.parse(String(init.body)) as Record<string, unknown> };
}

function post(body: unknown, origin?: string): Request {
  return new Request("https://wordink.app/api/folded-live", {
    method: "POST",
    headers: origin ? { origin } : {},
    body: JSON.stringify(body),
  });
}

const REJECT = { date: "2026-10-12", word: "timelessly", base: "time", rejected: true };

afterEach(() => vi.unstubAllGlobals());

describe("api/folded-live", () => {
  it("reads one puzzle's rejections, without a key, cached briefly", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    const fetchMock = stubFetch([{ word: "timelessly", base: "time", rejected_at: "2026-10-12T10:00:00Z" }]);
    const response = await handler(new Request("https://wordink.app/api/folded-live?date=2026-10-12"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage");
    expect(await response.json()).toEqual({
      rejections: [{ word: "timelessly", base: "time", at: "2026-10-12T10:00:00Z" }],
    });
    expect(sent(fetchMock)).toEqual({
      url: "https://project.supabase.co/rest/v1/rpc/list_live_fold_rejections",
      args: { p_date: "2026-10-12" },
    });
  });

  it("refuses a read without a date", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    const response = await handler(new Request("https://wordink.app/api/folded-live"));
    expect(response.status).toBe(400);
  });

  it("writes a rejection and answers with what is stored", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    const fetchMock = stubFetch(true);
    const response = await handler(post(REJECT, "https://wordink.app"));
    expect(await response.json()).toEqual({ rejected: true });
    expect(sent(fetchMock).args).toEqual({
      p_date: "2026-10-12",
      p_word: "timelessly",
      p_base: "time",
      p_rejected: true,
    });
  });

  it("refuses a cross-origin write and a malformed one", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    stubFetch(true);
    expect((await handler(post(REJECT, "https://evil.example"))).status).toBe(403);
    expect((await handler(post({ ...REJECT, word: "Bad Word" }))).status).toBe(400);
    expect((await handler(post({ ...REJECT, rejected: "yes" }))).status).toBe(400);
  });

  it("says when the database is unavailable", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    stubFetch(500);
    expect((await handler(post(REJECT))).status).toBe(502);
    vi.stubGlobal("process", { env: {} });
    expect((await handler(post(REJECT))).status).toBe(503);
  });

  it("says when the migration has not been applied", async () => {
    vi.stubGlobal("process", { env: CONFIGURED });
    stubFetch(404);
    const read = await handler(new Request("https://wordink.app/api/folded-live?date=2026-10-12"));
    expect(read.status).toBe(503);
    expect(await read.json()).toEqual({ ok: false, reason: "not-migrated" });
    const write = await handler(post(REJECT));
    expect(write.status).toBe(503);
    expect(await write.json()).toEqual({ ok: false, reason: "not-migrated" });
  });
});
