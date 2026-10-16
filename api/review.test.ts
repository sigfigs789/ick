import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./review";

const CONFIGURED = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

function withEnv(env: Record<string, string | undefined> = CONFIGURED) {
  vi.stubGlobal("process", { env });
}

function get(query: string): Request {
  return new Request(`https://wordink.app/api/review${query}`);
}

/** Stub the one PostgREST call the handler makes. */
function stubFetch(reply: unknown = []) {
  const fetchMock = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/review", () => {
  it("reads the word queue through its own function", async () => {
    withEnv();
    const fetchMock = stubFetch([
      {
        word: "enshittification",
        origin: "both",
        // Numerics arrive as strings over PostgREST.
        zipf: "1.42",
        pos: ["noun"],
        first_use: "2022",
        mw_source: "collegiate",
        lookups: 3,
        suggestions: 2,
        first_at: "2026-09-08T09:00:00Z",
        last_at: "2026-09-10T12:00:00Z",
        status: "accepted",
        // The live check approved this word mid-puzzle, which the row reports
        // separately from the verdict a person reached afterwards.
        outcome: "playable",
      },
    ]);
    const response = await handler(get("?list=suggested-words"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      words: [
        {
          word: "enshittification",
          origin: "both",
          zipf: 1.42,
          pos: ["noun"],
          firstUse: "2022",
          mwSource: "collegiate",
          lookups: 3,
          suggestions: 2,
          firstAt: "2026-09-08T09:00:00Z",
          lastAt: "2026-09-10T12:00:00Z",
          mark: "accepted",
          liveApproved: true,
        },
      ],
    });
    const call = rpcCall(fetchMock);
    expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/list_suggested_words");
    expect(call?.args).toEqual({ p_limit: 200 });
  });

  it("keeps an unattested word's missing frequency as null", async () => {
    withEnv();
    stubFetch([{ word: "blorp", origin: "player", zipf: null, pos: [], lookups: 0, suggestions: 1 }]);
    const body = (await (await handler(get("?list=suggested-words"))).json()) as {
      words: { zipf: number | null }[];
    };

    expect(body.words[0].zipf).toBeNull();
  });

  it("reads the feedback list, in the order the function returns it", async () => {
    withEnv();
    const fetchMock = stubFetch([
      { id: 7, feedback: "more vowels please", created_at: "2026-09-10T12:00:00Z", mark: null },
    ]);
    const response = await handler(get("?list=feedback&limit=50"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      feedback: [{ id: 7, text: "more vowels please", at: "2026-09-10T12:00:00Z", mark: null }],
    });
    const call = rpcCall(fetchMock);
    expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/list_feedback");
    expect(call?.args).toEqual({ p_limit: 50 });
  });

  it("never lets a shared cache keep either list", async () => {
    withEnv();
    stubFetch([]);
    const response = await handler(get("?list=feedback"));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a list it does not have, and a limit that is not one", async () => {
    withEnv();
    stubFetch([]);

    expect((await handler(get(""))).status).toBe(400);
    expect((await handler(get("?list=players"))).status).toBe(400);
    expect((await handler(get("?list=feedback&limit=0"))).status).toBe(400);
    expect((await handler(get("?list=feedback&limit=5000"))).status).toBe(400);
    expect((await handler(get("?list=feedback&limit=lots"))).status).toBe(400);
  });

  it("answers reads and marks, and nothing else", async () => {
    withEnv();
    stubFetch([]);
    const response = await handler(
      new Request("https://wordink.app/api/review?list=feedback", { method: "DELETE" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  it("says a deployment has no credentials rather than showing an empty list", async () => {
    withEnv({});
    const response = await handler(get("?list=suggested-words"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("turns a failed read into something the page can retry", async () => {
    withEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(500);
    const response = await handler(get("?list=feedback"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable" });
  });

  describe("marks", () => {
    // Marking is keyed, always -- these lists are linked from the game, so a
    // reader is not a curator. Every request here carries the key the
    // deployment is configured with.
    const KEYED = { ...CONFIGURED, REVIEW_TOKEN: "letmein" };

    function mark(body: unknown, init: RequestInit = {}): Request {
      return new Request("https://wordink.app/api/review?key=letmein", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...init,
      });
    }

    it("writes a word's mark to the column the dictionary pass reads", async () => {
      withEnv(KEYED);
      // `set_word_status` answers with how many rows it settled.
      const fetchMock = stubFetch([1]);
      const response = await handler(
        mark({ list: "suggested-words", ref: "blorp", mark: "rejected" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mark: "rejected" });
      const call = rpcCall(fetchMock);
      expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/set_word_status");
      expect(call?.args).toEqual({ p_words: ["blorp"], p_status: "rejected" });
    });

    it("clears a word's mark by returning it to the untriaged state", async () => {
      withEnv(KEYED);
      const fetchMock = stubFetch([1]);
      const response = await handler(mark({ list: "suggested-words", ref: "blorp", mark: null }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mark: null });
      expect(rpcCall(fetchMock)?.args).toEqual({ p_words: ["blorp"], p_status: "new" });
    });

    it("writes a note's mark to its own table, and answers with what is stored", async () => {
      withEnv(KEYED);
      const fetchMock = stubFetch("accepted");
      const response = await handler(mark({ list: "feedback", ref: 7, mark: "accepted" }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mark: "accepted" });
      const call = rpcCall(fetchMock);
      expect(call?.url).toBe("https://project.supabase.co/rest/v1/rpc/set_feedback_mark");
      expect(call?.args).toEqual({ p_event_id: 7, p_mark: "accepted" });
    });

    it("refuses a mark it does not have, and a reference of the wrong shape", async () => {
      withEnv(KEYED);
      stubFetch([1]);

      expect((await handler(mark({ list: "feedback", ref: 7, mark: "maybe" }))).status).toBe(400);
      expect((await handler(mark({ list: "feedback", ref: "seven" }))).status).toBe(400);
      expect((await handler(mark({ list: "suggested-words", ref: 7 }))).status).toBe(400);
      expect((await handler(mark({ list: "suggested-words", ref: "Blorp!" }))).status).toBe(400);
      expect((await handler(mark({ list: "players", ref: "blorp" }))).status).toBe(400);
      expect((await handler(mark("{"))).status).toBe(400);
    });

    it("takes marks from its own pages only", async () => {
      withEnv(KEYED);
      stubFetch([1]);
      const response = await handler(
        mark(
          { list: "feedback", ref: 7, mark: "accepted" },
          { headers: { "content-type": "application/json", origin: "https://elsewhere.test" } },
        ),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, reason: "cross-origin" });
    });

    it("tells the page a mark did not land", async () => {
      withEnv(KEYED);
      vi.spyOn(console, "error").mockImplementation(() => {});
      stubFetch(500);
      const response = await handler(mark({ list: "feedback", ref: 7, mark: "accepted" }));

      expect(response.status).toBe(502);
    });
  });

  describe("with a review token configured", () => {
    const GATED = { ...CONFIGURED, REVIEW_TOKEN: "letmein" };

    it("refuses every word mark when no token is configured at all", async () => {
      // Fails closed. Unset used to mean "anybody may mark", which on a page
      // linked from the game is a stranger triaging the dictionary.
      withEnv(CONFIGURED);
      const fetchMock = stubFetch([1]);
      const response = await handler(
        new Request("https://wordink.app/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: "suggested-words", ref: "blorp", mark: "accepted" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("takes a note's mark without a token, since nothing links to that page", async () => {
      // A note's mark follows the read: open where no token is configured. It
      // reaches no part of the game, and the alternative locks the maintainer
      // out of their own triage page.
      withEnv(CONFIGURED);
      stubFetch("accepted");
      const response = await handler(
        new Request("https://wordink.app/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: "feedback", ref: 7, mark: "accepted" }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("refuses a keyless note mark once a token is configured", async () => {
      withEnv(GATED);
      const fetchMock = stubFetch("accepted");
      const response = await handler(
        new Request("https://wordink.app/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: "feedback", ref: 7, mark: "accepted" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers a request carrying the key", async () => {
      withEnv(GATED);
      stubFetch([]);
      const response = await handler(get("?list=feedback&key=letmein"));

      expect(response.status).toBe(200);
    });

    it("refuses a mark that does not carry the key", async () => {
      withEnv(GATED);
      const fetchMock = stubFetch([1]);
      const response = await handler(
        new Request("https://wordink.app/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: "feedback", ref: 7, mark: "accepted" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers a keyless read of the queue, which is linked from the game", async () => {
      withEnv(GATED);
      stubFetch([]);

      expect((await handler(get("?list=suggested-words"))).status).toBe(200);
    });

    it("refuses a keyless read of the notes, which are linked from nowhere", async () => {
      // The two lists part company here: a queue of words is everybody's, and a
      // note is something one player wrote to us.
      withEnv(GATED);
      const fetchMock = stubFetch([]);

      expect((await handler(get("?list=feedback"))).status).toBe(401);
      expect((await handler(get("?list=feedback&key=letmeinn"))).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await handler(get("?list=feedback&key=letmein"))).status).toBe(200);
    });

    it("still answers the notes when no token is configured", async () => {
      // Unlike a mark, this does not fail closed: taking the feedback page away
      // from a deployment that has always read it without a token is a thing to
      // opt into, not to wake up to.
      withEnv(CONFIGURED);
      stubFetch([]);

      expect((await handler(get("?list=feedback"))).status).toBe(200);
    });

    it("refuses a mark whose key is wrong, without reaching the database", async () => {
      withEnv(GATED);
      const fetchMock = stubFetch([1]);
      const wrong = (key: string) =>
        new Request(`https://wordink.app/api/review?key=${key}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: "feedback", ref: 7, mark: "accepted" }),
        });

      // Wrong by a character, and wrong at the same length: the compare is
      // constant-time and neither shape gets any further.
      expect((await handler(wrong("letmeinn"))).status).toBe(401);
      expect((await handler(wrong("letmeon"))).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("reads the freeform trial as a tally, a breakdown and the notes", async () => {
    withEnv();
    // Two rpcs rather than one: the votes and the notes, asked for together.
    const fetchMock = vi.fn(async (url: string) => {
      const body = String(url).endsWith("list_freeform_votes")
        ? [
            { voter: "a", vote: "love", puzzle_date: "2026-09-14", created_at: "2026-09-14T10:00:00Z" },
            { voter: "b", vote: "boo", puzzle_date: "2026-09-14", created_at: "2026-09-14T11:00:00Z" },
            { voter: "c", vote: "love", puzzle_date: "2026-09-15", created_at: "2026-09-15T09:00:00Z" },
            // No date on the event: counted in the tally, left out of the
            // breakdown, because the verdict is real and only the day is missing.
            { voter: "d", vote: "love", puzzle_date: null, created_at: "2026-09-15T10:00:00Z" },
          ]
        : [
            {
              id: 19471,
              feedback: "two scores would be better",
              puzzle_date: "2026-09-14",
              vote: "love",
              created_at: "2026-09-14T15:22:23Z",
            },
          ];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(get("?list=freeform"));

    expect(response.status).toBe(200);
    const body = await response.json();
    // The voter ids stay in the database: the page shows sides and notes, and
    // has no use for who.
    expect(JSON.stringify(body)).not.toContain("voter");
    expect(body).toEqual({
      tally: { love: 3, boo: 1 },
      byDate: [
        { date: "2026-09-14", love: 1, boo: 1 },
        { date: "2026-09-15", love: 1, boo: 0 },
      ],
      notes: [
        {
          id: 19471,
          text: "two scores would be better",
          at: "2026-09-14T15:22:23Z",
          date: "2026-09-14",
          vote: "love",
        },
      ],
    });
  });

  it("keeps the freeform report behind the review token when one is set", async () => {
    withEnv({ ...CONFIGURED, REVIEW_TOKEN: "sesame" });
    const fetchMock = stubFetch([]);

    expect((await handler(get("?list=freeform"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await handler(get("?list=freeform&key=sesame"))).status).toBe(200);
  });
  it("passes the analytics report through for the window asked for", async () => {
    withEnv();
    const report = { asOf: "2026-09-27", daily: [] };
    const fetchMock = stubFetch(report);

    const response = await handler(get("?list=analytics&days=30"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => String(url).split("/").pop())).toEqual(["analytics_report"]);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ p_days: 30 });
  });

  it("reads sixty days when no window is asked for", async () => {
    withEnv();
    const fetchMock = stubFetch({});

    expect((await handler(get("?list=analytics"))).status).toBe(200);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ p_days: 60 });
  });

  it("refuses an analytics window other than a week to a year", async () => {
    withEnv();
    const fetchMock = stubFetch({});
    for (const days of ["0", "1", "3", "366", "abc", "7.5"]) {
      const response = await handler(get(`?list=analytics&days=${days}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, reason: "bad-days" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the analytics report without a key even when a review token is set", async () => {
    withEnv({ ...CONFIGURED, REVIEW_TOKEN: "sesame" });
    stubFetch({});

    expect((await handler(get("?list=analytics"))).status).toBe(200);
  });
});
