import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./validate";

// Shapes trimmed to the fields the handler actually reads (see MwEntry).
const CAT = { meta: { id: "cat", offensive: false }, fl: "noun", date: "1382", def: [{}] };
const ERST = {
  meta: { id: "erst", offensive: false },
  fl: "adverb",
  date: "12th century",
  def: [{ sls: ["archaic"], sseq: [[["sense", { dt: [["text", "erstwhile"]] }]]] }],
};
const CHILE_COUNTRY = { meta: { id: "Chile:g" }, fl: "geographical name" };
const ATM_ABBR = { meta: { id: "ATM" }, fl: "abbreviation" };
const SLUR = { meta: { id: "slur", offensive: true }, fl: "noun", def: [{}] };

function request(word: string): Request {
  return new Request(`https://wordink.app/api/validate?word=${word}`);
}

/**
 * Stub the two upstreams the handler talks to. `mw` is returned for both MW
 * references; `datamuse` for the frequency lookup.
 */
function stubFetch(options: {
  mw?: unknown;
  mwStatus?: number;
  mwBody?: string;
  datamuse?: unknown;
  mwThrows?: Error;
}) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("datamuse")) {
      return new Response(JSON.stringify(options.datamuse ?? []), { status: 200 });
    }
    if (options.mwThrows) throw options.mwThrows;
    if (options.mwStatus && options.mwStatus !== 200) {
      return new Response(options.mwBody ?? "", { status: options.mwStatus });
    }
    return new Response(JSON.stringify(options.mw ?? []), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// The handler reads keys off `process.env`; only the collegiate one is set so the
// tests exercise a single reference unless they say otherwise.
function withKeys(keys: Record<string, string | undefined> = { MW_COLLEGIATE_KEY: "test-key" }) {
  vi.stubGlobal("process", { env: keys });
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/validate word gate", () => {
  it("rejects malformed input without spending a lookup", async () => {
    withKeys();
    const fetchMock = stubFetch({});
    const result = await body(await handler(request("ab3")));
    expect(result).toMatchObject({ outcome: "error", reason: "malformed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unconfigured deployment rather than guessing", async () => {
    withKeys({});
    const fetchMock = stubFetch({});
    const response = await handler(request("cat"));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ outcome: "error", reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("api/validate classification", () => {
  it("accepts an ordinary current word and reports its first known use", async () => {
    withKeys();
    stubFetch({ mw: [CAT] });
    expect(await body(await handler(request("cat")))).toMatchObject({
      outcome: "playable",
      reason: null,
      firstUse: "1382",
      pos: ["noun"],
    });
  });

  it("strips MW's inline markup out of the first-use date", async () => {
    withKeys();
    // What MW actually returns for "cat".
    stubFetch({
      mw: [{ meta: { id: "cat" }, fl: "noun", date: "before 12th century{ds||1|a|}", def: [{}] }],
    });
    expect(await body(await handler(request("cat")))).toMatchObject({
      firstUse: "before 12th century",
    });
  });

  it("treats a def-block status label as covering every sense in it", async () => {
    withKeys();
    stubFetch({ mw: [ERST] });
    expect(await body(await handler(request("erst")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
    });
  });

  it("stays playable when only some senses are out of use", async () => {
    withKeys();
    stubFetch({
      mw: [
        {
          meta: { id: "quick" },
          fl: "adjective",
          def: [
            { sls: ["archaic"], sseq: [[["sense", {}]]] },
            { sseq: [[["sense", {}]]] },
          ],
        },
      ],
    });
    expect(await body(await handler(request("quick")))).toMatchObject({ outcome: "playable" });
  });

  it("rejects a proper noun even though MW answers the lowercase query", async () => {
    withKeys();
    stubFetch({ mw: [CHILE_COUNTRY] });
    expect(await body(await handler(request("chile")))).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });
  });

  it("rejects an abbreviation", async () => {
    withKeys();
    stubFetch({ mw: [ATM_ABBR] });
    expect(await body(await handler(request("atm")))).toMatchObject({
      outcome: "rejected",
      reason: "abbreviation",
    });
  });

  it("reports both when a word is a name and an abbreviation", async () => {
    withKeys();
    stubFetch({
      mw: [
        { meta: { id: "Aa:g" }, fl: "geographical name" },
        { meta: { id: "aa" }, fl: "abbreviation" },
      ],
    });
    expect(await body(await handler(request("aa")))).toMatchObject({
      reason: "name-or-abbreviation",
    });
  });

  it("rejects an offensive word so a live lookup can't bypass curation", async () => {
    withKeys();
    stubFetch({ mw: [SLUR] });
    expect(await body(await handler(request("slur")))).toMatchObject({
      outcome: "rejected",
      reason: "offensive",
    });
  });

  it("ignores entries whose headword is not the queried word", async () => {
    withKeys();
    // What MW actually does for a miss: related entries plus suggestion strings.
    stubFetch({ mw: [{ meta: { id: "burr" }, fl: "noun", def: [{}] }, "aarrgh"] });
    expect(await body(await handler(request("aaron")))).toMatchObject({
      outcome: "unknown",
      reason: null,
    });
  });

  it("counts an entry with a homograph suffix as a headword match", async () => {
    withKeys();
    stubFetch({ mw: [{ meta: { id: "chile:1" }, fl: "noun", def: [{}] }] });
    expect(await body(await handler(request("chile")))).toMatchObject({ outcome: "playable" });
  });
});

describe("api/validate frequency", () => {
  it("derives a Zipf from Datamuse's per-million frequency", async () => {
    withKeys();
    stubFetch({
      mw: [{ meta: { id: "zymurgy" }, fl: "noun", def: [{}] }],
      datamuse: [{ word: "zymurgy", tags: ["n", "f:0.001578"] }],
    });
    const result = await body(await handler(request("zymurgy")));
    // zipf = log10(0.001578) + 3
    expect(result.outcome).toBe("playable");
    expect(result.zipf as number).toBeCloseTo(0.198, 3);
  });

  it("ignores a near-miss match, since Datamuse's sp= is a pattern", async () => {
    withKeys();
    // Asking Datamuse for "abrasure" really does answer with "abrasive".
    stubFetch({
      mw: [{ meta: { id: "abrasure" }, fl: "noun", def: [{}] }],
      datamuse: [{ word: "abrasive", tags: ["adj", "f:1.490473"] }],
    });
    expect(await body(await handler(request("abrasure")))).toMatchObject({
      outcome: "playable",
      zipf: null,
    });
  });

  it("stays playable when the frequency lookup fails outright", async () => {
    withKeys();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("datamuse")) throw new Error("offline");
      return new Response(JSON.stringify([CAT]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await body(await handler(request("cat")))).toMatchObject({
      outcome: "playable",
      zipf: null,
    });
  });
});

describe("api/validate failure reporting", () => {
  it("names an exhausted quota from MW's 403 body", async () => {
    withKeys();
    stubFetch({ mwStatus: 403, mwBody: "You have exceeded your daily request limit." });
    const response = await handler(request("cat"));
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({
      outcome: "error",
      reason: "quota-exceeded",
      status: 403,
    });
  });

  it("separates a bad key from a spent quota", async () => {
    withKeys();
    stubFetch({ mwStatus: 403, mwBody: "Invalid API key. Not for use with this reference." });
    expect(await body(await handler(request("cat")))).toMatchObject({ reason: "invalid-key" });
  });

  it("reports an unexplained 403 without asserting a cause", async () => {
    withKeys();
    stubFetch({ mwStatus: 403, mwBody: "" });
    expect(await body(await handler(request("cat")))).toMatchObject({ reason: "forbidden" });
  });

  it("reports a network failure", async () => {
    withKeys();
    stubFetch({ mwThrows: new Error("connect ECONNREFUSED") });
    expect(await body(await handler(request("cat")))).toMatchObject({
      outcome: "error",
      reason: "network-error",
    });
  });

  it("never lets the CDN cache a failure", async () => {
    withKeys();
    stubFetch({ mwStatus: 500, mwBody: "boom" });
    const response = await handler(request("cat"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("caches a real verdict so repeat lookups don't spend quota", async () => {
    withKeys();
    stubFetch({ mw: [CAT] });
    const response = await handler(request("cat"));
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  });
});

describe("api/validate reference coverage", () => {
  /** Per-reference control: what collegiate and medical each answer. */
  function stubReferences(options: {
    collegiate?: unknown;
    medical?: unknown;
    collegiateStatus?: number;
    medicalStatus?: number;
    body?: string;
  }) {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("datamuse")) return new Response("[]", { status: 200 });
      const medical = href.includes("/medical/");
      const status = medical ? options.medicalStatus : options.collegiateStatus;
      if (status && status !== 200) {
        return new Response(options.body ?? "You have exceeded your daily request limit.", {
          status,
        });
      }
      // A miss answers with spelling-suggestion strings, not entries.
      const data = (medical ? options.medical : options.collegiate) ?? ["suggestion"];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const ORDINARY = (id: string) => ({ meta: { id }, fl: "noun", def: [{}] });
  const ARCHAIC = (id: string) => ({
    meta: { id },
    fl: "noun",
    def: [{ sls: ["archaic"], sseq: [[["sense", {}]]] }],
  });

  it("queries both references at once rather than one after the other", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    const fetchMock = stubReferences({ collegiate: [ORDINARY("cat")] });
    await handler(request("cat"));

    const references = fetchMock.mock.calls.map(([url]) => String(url));
    expect(references.some((u) => u.includes("/collegiate/"))).toBe(true);
    expect(references.some((u) => u.includes("/medical/"))).toBe(true);
  });

  it("accepts a word only the medical reference attests", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({ medical: [ORDINARY("costochondritis")] });
    expect(await body(await handler(request("costochondritis")))).toMatchObject({
      outcome: "playable",
      source: "medical",
    });
  });

  it("accepts a word medical lists as current even when collegiate calls it archaic", async () => {
    // The point of pooling both references: one reference calling a sense archaic
    // cannot veto the other listing it as a live term.
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({ collegiate: [ARCHAIC("emesis")], medical: [ORDINARY("emesis")] });
    expect(await body(await handler(request("emesis")))).toMatchObject({
      outcome: "playable",
      source: "collegiate+medical",
    });
  });

  it("still rejects a word both references call archaic", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({ collegiate: [ARCHAIC("erst")], medical: [ARCHAIC("erst")] });
    expect(await body(await handler(request("erst")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
    });
  });

  it("reports no source when neither reference has the word", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({});
    expect(await body(await handler(request("zzzzqx")))).toMatchObject({
      outcome: "unknown",
      source: null,
    });
  });

  it("treats a 429 as a spent quota", async () => {
    withKeys();
    stubFetch({ mwStatus: 429, mwBody: "Too many requests" });
    expect(await body(await handler(request("cat")))).toMatchObject({
      reason: "quota-exceeded",
      status: 429,
    });
  });
});

describe("api/validate partial failures", () => {
  function stubReferences(options: {
    collegiate?: unknown;
    medical?: unknown;
    collegiateStatus?: number;
    medicalStatus?: number;
  }) {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("datamuse")) return new Response("[]", { status: 200 });
      const medical = href.includes("/medical/");
      const status = medical ? options.medicalStatus : options.collegiateStatus;
      if (status && status !== 200) {
        return new Response("You have exceeded your daily request limit.", { status });
      }
      const data = (medical ? options.medical : options.collegiate) ?? ["suggestion"];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const ORDINARY = (id: string) => ({ meta: { id }, fl: "noun", def: [{}] });

  it("counts an approval as a success even when the other reference failed", async () => {
    // One reference being down changed nothing about the answer, so it is not
    // reported as a failure.
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    const response = await (async () => {
      stubReferences({ collegiateStatus: 403, medical: [ORDINARY("costochondritis")] });
      return handler(request("costochondritis"));
    })();

    expect(await body(response)).toMatchObject({
      outcome: "playable",
      source: "medical",
      failure: null,
    });
    // A definitive approval is still worth caching.
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("reports the failure when the surviving reference did not approve", async () => {
    // Here the reference we couldn't reach might have been the one that would
    // have approved it, so the verdict is genuinely incomplete.
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({ collegiateStatus: 403, medical: [{ meta: { id: "atm" }, fl: "abbreviation" }] });
    const response = await handler(request("atm"));

    expect(await body(response)).toMatchObject({
      outcome: "rejected",
      reason: "abbreviation",
      failure: { reason: "quota-exceeded", status: 403 },
    });
    // An incomplete verdict must not be cached for a day.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("errors rather than claiming a word is unknown when a reference failed", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubReferences({ collegiateStatus: 403 });
    const response = await handler(request("zzzzqx"));
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({
      outcome: "error",
      reason: "quota-exceeded",
    });
  });
});

describe("api/validate sighting recording", () => {
  const SUPABASE = {
    MW_COLLEGIATE_KEY: "test-key",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };

  /**
   * The handler deliberately does not await the sighting write -- a player must
   * never wait on recording -- so let the microtask queue drain before looking
   * for it.
   */
  async function settled() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** The recording call, if any, out of the handler's stubbed fetch calls. */
  function sighting(fetchMock: ReturnType<typeof stubFetch>) {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/rest/v1/rpc/"));
    if (!call) return null;
    const [url, init] = call as unknown as [string, RequestInit | undefined];
    return { url, init, body: JSON.parse(String(init?.body ?? "null")) as Record<string, unknown> };
  }

  it("records a playable verdict without disturbing the response", async () => {
    withKeys(SUPABASE);
    const fetchMock = stubFetch({ mw: [CAT], datamuse: [{ word: "cat", tags: ["f:180.5"] }] });

    // The handler reads the body off a clone, so the caller still gets its own.
    expect(await body(await handler(request("cat")))).toMatchObject({
      word: "cat",
      outcome: "playable",
    });
    await settled();

    const recorded = sighting(fetchMock);
    expect(recorded?.url).toBe("https://project.supabase.co/rest/v1/rpc/record_word_sighting");
    expect(recorded?.init?.method).toBe("POST");
    expect(recorded?.body).toMatchObject({
      p_word: "cat",
      p_outcome: "playable",
      p_reason: null,
      p_pos: ["noun"],
      p_first_use: "1382",
      p_source: "collegiate",
    });
    expect(recorded?.body.p_zipf).toBeCloseTo(Math.log10(180.5) + 3, 6);
  });

  it("records why a word MW knows was still rejected", async () => {
    withKeys(SUPABASE);
    const fetchMock = stubFetch({ mw: [ERST] });
    await handler(request("erst"));
    await settled();
    expect(sighting(fetchMock)?.body).toMatchObject({
      p_word: "erst",
      p_outcome: "rejected",
      p_reason: "archaic",
      p_zipf: null,
    });
  });

  it("records that MW has no such word", async () => {
    withKeys(SUPABASE);
    const fetchMock = stubFetch({ mw: ["spelling-suggestion"] });
    await handler(request("zzzzqx"));
    await settled();
    expect(sighting(fetchMock)?.body).toMatchObject({ p_word: "zzzzqx", p_outcome: "unknown" });
  });

  it("never records a failed lookup, which says nothing about the word", async () => {
    withKeys(SUPABASE);
    const fetchMock = stubFetch({ mwStatus: 429, mwBody: "Too many requests" });
    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "error" });
    await settled();
    expect(sighting(fetchMock)).toBeNull();
  });

  it("never records malformed input", async () => {
    withKeys(SUPABASE);
    const fetchMock = stubFetch({});
    await handler(request("ab3"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips recording entirely when the deployment has no Supabase credentials", async () => {
    withKeys();
    const fetchMock = stubFetch({ mw: [CAT] });
    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "playable" });
    await settled();
    expect(sighting(fetchMock)).toBeNull();
  });

  it("keeps answering the word when the recording write fails", async () => {
    withKeys(SUPABASE);
    // Every call throws except MW's, so the write is the thing that breaks.
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("dictionaryapi")) return new Response(JSON.stringify([CAT]), { status: 200 });
      if (href.includes("/rest/v1/rpc/")) throw new Error("supabase unreachable");
      return new Response("[]", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "playable" });
  });

  it("answers the word without waiting for the write to finish", async () => {
    withKeys(SUPABASE);
    // The recording write never settles. If the handler awaited it, this test
    // would time out rather than pass -- which is the point: a player must not
    // be made to wait on tracking.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/rest/v1/rpc/")) return new Promise<Response>(() => {});
        if (String(url).includes("dictionaryapi")) {
          return new Response(JSON.stringify([CAT]), { status: 200 });
        }
        return new Response("[]", { status: 200 });
      })
    );

    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "playable" });
  });
});

describe("api/validate read-through cache", () => {
  const CACHED = {
    MW_COLLEGIATE_KEY: "test-key",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };

  /**
   * Stub the three things the handler can now talk to: the cache read, the
   * upstreams, and the recording write. `stored` is the row the read returns
   * (null for a miss); `readFails` makes the read reject, standing in for a
   * Supabase outage; `readHangs` makes it never answer, so the timeout decides.
   */
  function stubAll(options: {
    stored?: Record<string, unknown> | null;
    readFails?: boolean;
    readHangs?: boolean;
    mw?: unknown;
  }) {
    const calls = { read: 0, mw: 0, datamuse: 0, rpc: [] as string[] };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/rest/v1/rpc/")) {
        calls.rpc.push(href.split("/rest/v1/rpc/")[1]);
        return new Response("", { status: 200 });
      }
      if (href.includes("/rest/v1/word_sightings")) {
        calls.read += 1;
        if (options.readFails) throw new Error("supabase unreachable");
        if (options.readHangs) {
          // Honour the abort signal the way a real fetch does, so the handler's
          // own timeout is what ends the wait.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }
        return new Response(JSON.stringify(options.stored ? [options.stored] : []), { status: 200 });
      }
      if (href.includes("datamuse")) {
        calls.datamuse += 1;
        return new Response("[]", { status: 200 });
      }
      calls.mw += 1;
      // MW only counts entries whose headword matches the query, so the stubbed
      // entry is built for whatever word was asked about.
      const asked = new URL(href).pathname.split("/").pop() ?? "";
      const entry = { meta: { id: asked }, fl: "noun", date: "1382", def: [{}] };
      return new Response(JSON.stringify(options.mw ?? [entry]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  const row = (over: Record<string, unknown> = {}) => ({
    outcome: "playable",
    reason: null,
    zipf: 2.61,
    pos: ["adjective"],
    first_use: "1815",
    source: "collegiate",
    verdict_at: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  });

  /** Wait for the deferred recording write. */
  async function settled() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("answers from its own record without spending an upstream call", async () => {
    withKeys(CACHED);
    const calls = stubAll({ stored: row() });

    const response = await handler(request("quixotic"));
    expect(response.headers.get("x-verdict-source")).toBe("cache");
    expect(await body(response)).toMatchObject({
      word: "quixotic",
      outcome: "playable",
      zipf: 2.61,
      pos: ["adjective"],
      firstUse: "1815",
      source: "collegiate",
    });
    // The whole point: neither upstream was touched.
    expect(calls.mw).toBe(0);
    expect(calls.datamuse).toBe(0);
  });

  it("counts a cached answer as a sighting without refreshing the verdict", async () => {
    withKeys(CACHED);
    const calls = stubAll({ stored: row() });
    await handler(request("quixotic"));
    await settled();
    // record_word_hit moves the counters; record_word_sighting would also reset
    // verdict_at, which would stop the row ever being re-checked.
    expect(calls.rpc).toEqual(["record_word_hit"]);
  });

  it("serves a remembered rejection too", async () => {
    withKeys(CACHED);
    const calls = stubAll({ stored: row({ outcome: "rejected", reason: "archaic", zipf: null }) });
    expect(await body(await handler(request("erst")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
      zipf: null,
    });
    expect(calls.mw).toBe(0);
  });

  it("answers from cache even with no Merriam-Webster key configured", async () => {
    withKeys({ SUPABASE_URL: CACHED.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-key" });
    stubAll({ stored: row() });
    const response = await handler(request("quixotic"));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ outcome: "playable" });
  });

  it("goes upstream when nothing is on file", async () => {
    withKeys(CACHED);
    const calls = stubAll({ stored: null });
    const response = await handler(request("cat"));
    expect(response.headers.get("x-verdict-source")).toBe("live");
    expect(await body(response)).toMatchObject({ outcome: "playable" });
    expect(calls.read).toBe(1);
    expect(calls.mw).toBe(1);
  });

  it("re-checks a verdict that has gone stale", async () => {
    withKeys(CACHED);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const calls = stubAll({ stored: row({ verdict_at: old }) });
    expect(await body(await handler(request("quixotic")))).toMatchObject({ outcome: "playable" });
    expect(calls.mw).toBe(1);
  });

  it("re-checks a remembered miss far sooner than a real verdict", async () => {
    withKeys(CACHED);
    const twentyDays = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    // Twenty days is still fresh for a verdict, but not for "MW has no such
    // word" -- MW may have added it since.
    const stale = stubAll({ stored: row({ outcome: "unknown", verdict_at: twentyDays }) });
    await handler(request("skateable"));
    expect(stale.mw).toBe(1);

    const threeDays = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = stubAll({ stored: row({ outcome: "unknown", verdict_at: threeDays }) });
    expect(await body(await handler(request("skateable")))).toMatchObject({ outcome: "unknown" });
    expect(fresh.mw).toBe(0);
  });

  it("ignores a suggestion-box row, which carries no verdict", async () => {
    withKeys(CACHED);
    const calls = stubAll({ stored: row({ outcome: "suggested", zipf: null, source: null }) });
    expect(await body(await handler(request("petrichor")))).toMatchObject({ outcome: "playable" });
    expect(calls.mw).toBe(1);
  });

  it("falls through when the cache read errors", async () => {
    withKeys(CACHED);
    const calls = stubAll({ readFails: true });
    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "playable" });
    expect(calls.mw).toBe(1);
  });

  it("falls through when the cache read is too slow to wait for", async () => {
    withKeys(CACHED);
    const calls = stubAll({ readHangs: true });
    // The read never answers; the handler's own budget ends the wait and the
    // upstreams decide, so a wedged database cannot stall a word check.
    expect(await body(await handler(request("cat")))).toMatchObject({ outcome: "playable" });
    expect(calls.mw).toBe(1);
  });
});
