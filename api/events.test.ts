import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./events";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

/** Stub the only outbound call the handler makes: the PostgREST insert. */
function stubFetch(options: { status?: number; throws?: Error } = {}) {
  const fetchMock = vi.fn(async () => {
    if (options.throws) throw options.throws;
    return new Response("", { status: options.status ?? 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://wordink.app/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

/** The row the handler asked PostgREST to insert. */
function inserted(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?];
  if (!url) return null;
  return { url, init, row: JSON.parse(String(init?.body ?? "null")) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/events recording", () => {
  it("records an event and its properties", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(
      post({ name: "answer_accepted", props: { word: "quixotic", score: 9.4, applied: true } })
    );

    expect(response.status).toBe(202);
    const write = inserted(fetchMock);
    expect(write?.url).toBe("https://project.supabase.co/rest/v1/analytics_events");
    expect(write?.init?.method).toBe("POST");
    expect((write?.init?.headers as Record<string, string>).apikey).toBe("service-key");
    expect(write?.row).toEqual({
      name: "answer_accepted",
      props: { word: "quixotic", score: 9.4, applied: true },
    });
  });

  it("records an event that carries no properties", async () => {
    withEnv();
    const fetchMock = stubFetch();
    expect((await handler(post({ name: "arrived_from_twitter" }))).status).toBe(202);
    expect(inserted(fetchMock)?.row).toEqual({ name: "arrived_from_twitter", props: {} });
  });

  it("truncates a long free-text property rather than rejecting the event", async () => {
    withEnv();
    const fetchMock = stubFetch();
    await handler(post({ name: "feedback_submitted", props: { feedback: "x".repeat(5000) } }));
    const props = inserted(fetchMock)?.row.props as Record<string, string>;
    expect(props.feedback).toHaveLength(4000);
  });

  it("drops an event sent to a *.vercel.app host", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(
      new Request("https://ick-git-branch-sigfigs789.vercel.app/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "answer_accepted", props: { word: "quixotic" } }),
      })
    );
    expect(response.status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the event even when the write itself fails", async () => {
    withEnv();
    stubFetch({ throws: new Error("supabase unreachable") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await handler(post({ name: "site_visit" }))).status).toBe(202);
  });

  it("says so when the deployment has no Supabase credentials", async () => {
    withEnv({});
    const fetchMock = stubFetch();
    const response = await handler(post({ name: "site_visit" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("api/events input gate", () => {
  it("takes POST only", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(new Request("https://wordink.app/api/events"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stamps a site_visit with the verdict on its user agent, never the string", async () => {
    withEnv();
    const fetchMock = stubFetch();
    await handler(
      post(
        { name: "site_visit", props: { source: "direct" } },
        { headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/126.0.0.0 Safari/537.36" } }
      )
    );
    expect(inserted(fetchMock)?.row).toEqual({
      name: "site_visit",
      props: { source: "direct", server_bot_ua: true },
    });
  });

  it("leaves every other event's props as sent", async () => {
    withEnv();
    const fetchMock = stubFetch();
    await handler(
      post({ name: "visit_interacted", props: {} }, { headers: { "user-agent": "HeadlessChrome/126" } })
    );
    expect(inserted(fetchMock)?.row).toEqual({ name: "visit_interacted", props: {} });
  });

  it("refuses a post from another origin", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(
      post({ name: "site_visit" }, { headers: { origin: "https://elsewhere.example" } })
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a post from its own origin", async () => {
    withEnv();
    stubFetch();
    const response = await handler(
      post({ name: "site_visit" }, { headers: { origin: "https://wordink.app" } })
    );
    expect(response.status).toBe(202);
  });

  it.each([
    ["not json at all", "{oops"],
    ["a bare array", [{ name: "site_visit" }]],
    ["a missing name", { props: { word: "cat" } }],
    ["a name that isn't an identifier", { name: "Site Visit!" }],
    ["properties that aren't an object", { name: "site_visit", props: ["word"] }],
    ["a nested property value", { name: "site_visit", props: { state: { deep: 1 } } }],
    // JSON has no NaN or Infinity literal, but an overflowing exponent parses to
    // Infinity, which must not reach a numeric column.
    ["a number that overflows to Infinity", '{"name":"site_visit","props":{"score":1e999}}'],
  ])("rejects %s", async (_label, payload) => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(post(payload));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an event with too many properties", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const props = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, i]));
    expect((await handler(post({ name: "site_visit", props }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before parsing it", async () => {
    withEnv();
    const fetchMock = stubFetch();
    const response = await handler(post("x".repeat(9 * 1024)));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
