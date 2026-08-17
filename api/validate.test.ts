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
  /** Collegiate misses (spelling suggestions); the medical reference has it. */
  function stubMedicalOnly(entry: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("datamuse")) return new Response("[]", { status: 200 });
        const body = href.includes("/medical/") ? [entry] : ["piloerector", "pilocarpine"];
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
  }

  it("accepts a word only the medical reference attests", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    stubMedicalOnly({ meta: { id: "piloerection" }, fl: "noun", def: [{}] });
    expect(await body(await handler(request("piloerection")))).toMatchObject({
      outcome: "playable",
    });
  });

  it("consults both references when both keys are set", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c", MW_MEDICAL_KEY: "m" });
    const fetchMock = stubFetch({ mw: [] });
    await handler(request("cat"));
    const references = fetchMock.mock.calls.map(([url]) => String(url));
    expect(references.some((u) => u.includes("/collegiate/"))).toBe(true);
    expect(references.some((u) => u.includes("/medical/"))).toBe(true);
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
