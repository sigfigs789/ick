import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./fold-reviews";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  REVIEW_TOKEN: "let-me-in",
};

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

function get(query = "?key=let-me-in"): Request {
  return new Request(`https://wordink.app/api/fold-reviews${query}`);
}

function post(body: unknown, query = "?key=let-me-in", origin?: string): Request {
  return new Request(`https://wordink.app/api/fold-reviews${query}`, {
    method: "POST",
    headers: origin ? { origin } : {},
    body: JSON.stringify(body),
  });
}

/** Stub the one PostgREST call the handler makes. */
function stubFetch(reply: unknown = []) {
  const fetchMock = vi.fn(async () => {
    if (typeof reply === "number") return new Response("boom", { status: reply });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The function the handler called, and what it sent. */
function rpcCall(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?];
  if (!url) return null;
  return { url, args: JSON.parse(String(init?.body ?? "null")) as Record<string, unknown> };
}

const VERDICT = {
  word: "timelinesses",
  base: "time",
  ownZipf: 1.2,
  baseZipf: 5.4,
  date: "2026-09-27",
  verdict: "rejected",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/fold-reviews", () => {
  it("reads the ledger through its own function", async () => {
    withEnv();
    const fetchMock = stubFetch([
      {
        word: "timelinesses",
        base: "time",
        // Numerics arrive as strings over PostgREST.
        own_zipf: "1.20",
        base_zipf: "5.40",
        verdict: "rejected",
        suggested_base: "timeliness",
        puzzle_date: "2026-09-27",
        reviewed_at: "2026-09-22T09:00:00Z",
      },
    ]);

    const response = await handler(get());
    expect(response.status).toBe(200);
    expect(rpcCall(fetchMock)?.url).toContain("/rpc/list_fold_reviews");
    expect(await response.json()).toEqual({
      reviews: [
        {
          word: "timelinesses",
          base: "time",
          ownZipf: 1.2,
          baseZipf: 5.4,
          verdict: "rejected",
          suggestedBase: "timeliness",
          date: "2026-09-27",
          at: "2026-09-22T09:00:00Z",
        },
      ],
    });
  });

  it("is never cached, in either direction", async () => {
    withEnv();
    stubFetch();
    expect((await handler(get())).headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a read without the key", async () => {
    withEnv();
    stubFetch();
    const response = await handler(get("?key=wrong"));
    expect(response.status).toBe(401);
  });

  it("answers anybody when no token is configured, like the feedback list", async () => {
    // Unlinked is not protected, and a deployment with no token configured is a
    // maintainer reading their own page rather than an open door anybody found.
    withEnv({ ...CONFIGURED, REVIEW_TOKEN: undefined });
    stubFetch([]);
    expect((await handler(get(""))).status).toBe(200);
    stubFetch([{ verdict: "rejected", suggested_base: null }]);
    expect((await handler(post(VERDICT, ""))).status).toBe(200);
  });

  it("refuses a write without the key where a token is set", async () => {
    withEnv();
    stubFetch();
    expect((await handler(post(VERDICT, "?key=wrong"))).status).toBe(401);
  });

  it("stores a verdict and answers with what the database kept", async () => {
    withEnv();
    const fetchMock = stubFetch([{ verdict: "rejected", suggested_base: "timeliness" }]);

    const response = await handler(post({ ...VERDICT, suggestedBase: "timeliness" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verdict: "rejected",
      suggestedBase: "timeliness",
    });
    const call = rpcCall(fetchMock);
    expect(call?.url).toContain("/rpc/set_fold_review");
    expect(call?.args).toEqual({
      p_word: "timelinesses",
      p_base: "time",
      p_own_zipf: 1.2,
      p_base_zipf: 5.4,
      p_puzzle_date: "2026-09-27",
      p_verdict: "rejected",
      p_suggested_base: "timeliness",
    });
  });

  it("stores a rejection that recommends nothing as no fold at all", async () => {
    // The answer a plain rejection has always meant, and the one an empty box
    // on the page sends: exported, it stops the fold rather than redirecting it.
    withEnv();
    const fetchMock = stubFetch([{ verdict: "rejected", suggested_base: null }]);
    const response = await handler(post(VERDICT));
    expect(await response.json()).toEqual({ verdict: "rejected", suggestedBase: null });
    expect(rpcCall(fetchMock)?.args.p_suggested_base).toBe(null);
  });

  it("refuses a recommendation that is not a word, or is the word itself", async () => {
    withEnv();
    stubFetch();
    expect((await handler(post({ ...VERDICT, suggestedBase: "Timely!" }))).status).toBe(400);
    // A word folding to itself is not a fold. Refused rather than dropped: it is
    // the page sending something it should not have sent.
    expect((await handler(post({ ...VERDICT, suggestedBase: "timelinesses" }))).status).toBe(400);
  });

  it("takes a verdict back with a null", async () => {
    withEnv();
    const fetchMock = stubFetch([{ verdict: null, suggested_base: null }]);
    const response = await handler(post({ ...VERDICT, verdict: null }));
    expect(await response.json()).toEqual({ verdict: null, suggestedBase: null });
    expect(rpcCall(fetchMock)?.args.p_verdict).toBe(null);
  });

  it("stores no frequency for a word no corpus attests", async () => {
    withEnv();
    const fetchMock = stubFetch([{ verdict: "approved", suggested_base: null }]);
    await handler(post({ ...VERDICT, ownZipf: null, verdict: "approved" }));
    expect(rpcCall(fetchMock)?.args.p_own_zipf).toBe(null);
  });

  it("refuses a malformed verdict", async () => {
    withEnv();
    stubFetch();
    expect((await handler(post({ ...VERDICT, word: "Timely!" }))).status).toBe(400);
    expect((await handler(post({ ...VERDICT, base: "" }))).status).toBe(400);
    expect((await handler(post({ ...VERDICT, verdict: "maybe" }))).status).toBe(400);
    expect((await handler(post({ ...VERDICT, date: "tomorrow" }))).status).toBe(400);
  });

  it("refuses a cross-origin write", async () => {
    withEnv();
    stubFetch();
    const response = await handler(post(VERDICT, "?key=let-me-in", "https://elsewhere.example"));
    expect(response.status).toBe(403);
  });

  it("says so plainly when the deployment has no database", async () => {
    withEnv({ REVIEW_TOKEN: "let-me-in" });
    stubFetch();
    expect((await handler(get())).status).toBe(503);
    expect((await handler(post(VERDICT))).status).toBe(503);
  });

  it("turns an upstream failure into a 502", async () => {
    withEnv();
    stubFetch(500);
    expect((await handler(get())).status).toBe(502);
    expect((await handler(post(VERDICT))).status).toBe(502);
  });

  it("answers nothing else", async () => {
    withEnv();
    stubFetch();
    const response = await handler(
      new Request("https://wordink.app/api/fold-reviews", { method: "DELETE" })
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });
});
