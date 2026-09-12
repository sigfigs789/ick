/**
 * The live check, answered from the website's verdicts instead of Merriam-Webster.
 *
 * Two things here are worth more than the rest. `unknown` and `error` must never
 * be confused: one says the word was judged and found wanting, the other says
 * nothing was learned, and returning the first for the second rejects a real
 * word on no evidence. And an error must never be cached, or one blip becomes an
 * hour of wrong answers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./redis-fake";

const redis = new FakeRedis();
const stored = new Map<string, string>();
const settings = { get: async (key: string) => stored.get(key) };

vi.mock("@devvit/web/server", () => ({ redis, settings }));

const { verdictFor } = await import("../src/server/core/verdicts");

/** One row as `word_verdict` returns it. */
function row(over: Record<string, unknown> = {}) {
  return {
    word: "enshittification",
    outcome: "playable",
    reason: null,
    zipf: 1.42,
    pos: ["noun"],
    first_use: "2022",
    source: "collegiate",
    ...over,
  };
}

/** Stub the Supabase call, returning whatever rows the test names. */
function stubRpc(rows: unknown[], init: ResponseInit = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  Object.assign(redis, new FakeRedis());
  stored.clear();
  stored.set("supabaseUrl", "https://example.supabase.co");
  stored.set("supabaseAnonKey", "anon-key");
  vi.unstubAllGlobals();
});

describe("a word the website has judged", () => {
  it("comes back in the keys the shared client parses", async () => {
    stubRpc([row()]);
    expect(await verdictFor("enshittification")).toMatchObject({
      word: "enshittification",
      outcome: "playable",
      zipf: 1.42,
      pos: ["noun"],
      firstUse: "2022",
      source: "collegiate",
    });
  });

  it("carries the reason a known word is still not playable", async () => {
    stubRpc([row({ outcome: "rejected", reason: "proper-noun" })]);
    expect(await verdictFor("enshittification")).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });
  });

  it("keeps an unattested frequency null rather than zero", async () => {
    // Null is the game's unattested floor -- the rarest thing it can score. A
    // zero would make the same word the commonest.
    stubRpc([row({ zipf: null })]);
    expect((await verdictFor("enshittification")).zipf).toBeNull();
  });

  it("is served from Redis the second time, without asking again", async () => {
    const fetchMock = stubRpc([row()]);
    await verdictFor("enshittification");
    await verdictFor("enshittification");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a word the website has never judged", () => {
  it("is unknown, which leaves the game's own rejection standing", async () => {
    stubRpc([]);
    expect(await verdictFor("zzzzzz")).toMatchObject({ outcome: "unknown", zipf: null });
  });

  it("is cached, but for much less time than a real verdict", async () => {
    stubRpc([]);
    await verdictFor("zzzzzz");
    const unknownTtl = redis.ttlOf("verdict:zzzzzz");

    stubRpc([row()]);
    await verdictFor("enshittification");
    const verdictTtl = redis.ttlOf("verdict:enshittification");

    // The website judging a word for the first time is the event a long cache
    // would hide, so "never judged" has to expire quickly.
    expect(unknownTtl).toBeLessThan(verdictTtl!);
  });
});

describe("a lookup that fails", () => {
  it("is an error, never an unknown", async () => {
    stubRpc([], { status: 500 });
    const verdict = await verdictFor("enshittification");
    expect(verdict.outcome).toBe("error");
    // The distinction that matters: unknown would reject a real word on the
    // strength of a failed request.
    expect(verdict.outcome).not.toBe("unknown");
  });

  it("reports a platform refusal as permanent, so the client stops asking", async () => {
    // Outbound HTTP is granted by Reddit, not declared by the app. Where it has
    // not been granted, every lookup is refused before it leaves -- and
    // `forbidden` is in the client's PERMANENT_FAILURES, so it asks once and
    // then plays on with the bundled dictionary alone.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("7 PERMISSION_DENIED: HTTP request to domain: x.supabase.co is not allowed");
    }));
    expect(await verdictFor("enshittification")).toMatchObject({
      outcome: "error",
      reason: "forbidden",
    });
  });

  it("keeps an ordinary failure retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }));
    // Not permanent: a blip must not disable the check for the session.
    expect(await verdictFor("enshittification")).toMatchObject({
      outcome: "error",
      reason: "upstream-error",
    });
  });

  it("survives the request throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    expect(await verdictFor("enshittification")).toMatchObject({ outcome: "error" });
  });

  it("is not cached, so a blip does not outlive itself", async () => {
    stubRpc([], { status: 500 });
    await verdictFor("enshittification");
    expect(redis.ttlOf("verdict:enshittification")).toBeUndefined();

    const fetchMock = stubRpc([row()]);
    expect(await verdictFor("enshittification")).toMatchObject({ outcome: "playable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfigured install with a reason the client stops asking on", async () => {
    stored.clear();
    const fetchMock = stubRpc([row()]);
    // `unconfigured` is in the client's PERMANENT_FAILURES, so it disables live
    // lookups for the session rather than making a round trip per guess.
    expect(await verdictFor("enshittification")).toMatchObject({
      outcome: "error",
      reason: "unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses something that is not a word without asking", async () => {
    const fetchMock = stubRpc([row()]);
    expect(await verdictFor("not a word!")).toMatchObject({ outcome: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
