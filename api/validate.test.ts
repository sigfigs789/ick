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

describe("api/validate Wordnik tier", () => {
  /**
   * Stub all three upstreams separately. `mw` answers both MW references (a miss
   * answers with spelling-suggestion strings, as MW really does), `wordnik` the
   * definitions call, `datamuse` the frequency lookup.
   */
  function stubTiers(options: {
    mw?: unknown;
    wordnik?: unknown;
    wordnikStatus?: number;
    wordnikBody?: string;
    datamuse?: unknown;
  }) {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("datamuse")) {
        return new Response(JSON.stringify(options.datamuse ?? []), { status: 200 });
      }
      if (href.includes("wordnik")) {
        if (options.wordnikStatus && options.wordnikStatus !== 200) {
          return new Response(options.wordnikBody ?? "", { status: options.wordnikStatus });
        }
        return new Response(JSON.stringify(options.wordnik ?? []), { status: 200 });
      }
      return new Response(JSON.stringify(options.mw ?? ["suggestion"]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const bothKeys = { MW_COLLEGIATE_KEY: "c", WORDNIK_KEY: "w" };
  /** A measured frequency, which every Wordnik approval now requires. */
  const attested = (word: string) => [{ word, tags: ["f:0.01"] }];
  /** Shapes trimmed to the fields the handler reads (see WordnikDefinition). */
  const def = (
    word: string,
    sourceDictionary: string,
    extra: Record<string, unknown> = {}
  ) => ({ word, sourceDictionary, text: "a definition", partOfSpeech: "noun", ...extra });

  it("does not spend a Wordnik lookup when MW already attests the word", async () => {
    withKeys(bothKeys);
    const fetchMock = stubTiers({ mw: [CAT] });
    expect(await body(await handler(request("cat")))).toMatchObject({
      outcome: "playable",
      source: "collegiate",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("wordnik"))).toBe(false);
  });

  it("accepts a word only AHD attests, naming the dictionary that answered", async () => {
    withKeys(bothKeys);
    stubTiers({ wordnik: [def("thalweg", "ahd-5")], datamuse: attested("thalweg") });
    expect(await body(await handler(request("thalweg")))).toMatchObject({
      outcome: "playable",
      source: "wordnik:ahd-5",
      pos: ["noun"],
    });
  });

  it("scores a Wordnik-approved word on a measured frequency", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [def("thalweg", "wordnet")],
      datamuse: [{ word: "thalweg", tags: ["f:0.01"] }],
    });
    expect(await body(await handler(request("thalweg")))).toMatchObject({
      outcome: "playable",
      source: "wordnik:wordnet",
      zipf: 1,
    });
  });

  it("lets Wiktionary's register tags veto a word AHD lists without a label", async () => {
    // Measured against the live API: AHD returns "gramercy" with labels: [], while
    // Wiktionary tags every sense archaic. AHD's silence must not approve it.
    withKeys(bothKeys);
    const archaic = { labels: [{ text: "archaic", type: "chronological" }] };
    stubTiers({
      wordnik: [
        def("gramercy", "ahd-5", { partOfSpeech: "interjection" }),
        def("gramercy", "wiktionary", { partOfSpeech: "interjection", ...archaic }),
        def("gramercy", "wiktionary", { partOfSpeech: "noun", ...archaic }),
      ],
    });
    expect(await body(await handler(request("gramercy")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
    });
  });

  it("does not let a veto stand when Wiktionary lists a current sense too", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [
        def("thalweg", "ahd-5"),
        def("thalweg", "wiktionary", { labels: [{ text: "obsolete", type: "chronological" }] }),
        def("thalweg", "wiktionary", { labels: [{ text: "geology", type: "field" }] }),
      ],
      datamuse: attested("thalweg"),
    });
    expect(await body(await handler(request("thalweg")))).toMatchObject({
      outcome: "playable",
      source: "wordnik:ahd-5",
    });
  });

  it("reads AHD's own register mark whatever label type it files it under", async () => {
    // "anon" really comes back with {"text":"Archaic","type":"fld"}.
    withKeys(bothKeys);
    stubTiers({
      wordnik: [
        def("anon", "ahd-5", { partOfSpeech: "adverb", labels: [{ text: "Archaic", type: "fld" }] }),
      ],
    });
    expect(await body(await handler(request("anon")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
    });
  });

  it("reports the mildest register when the senses disagree on how dead a word is", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [
        def("wight", "ahd-5", { labels: [{ text: "Obsolete", type: "fld" }] }),
        def("wight", "ahd-5", { labels: [{ text: "Dated", type: "fld" }] }),
      ],
    });
    expect(await body(await handler(request("wight")))).toMatchObject({
      outcome: "rejected",
      reason: "dated",
    });
  });

  it("ignores a word only the archaic-heavy sources attest, so the rejection stands", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [
        def("gramercy", "century"),
        def("gramercy", "gcide"),
        def("gramercy", "wiktionary"),
        def("gramercy", "webster"),
      ],
    });
    const response = await handler(request("gramercy"));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      outcome: "unknown",
      source: null,
      failure: null,
    });
  });

  it("rejects a word AHD labels archaic in every sense", async () => {
    withKeys(bothKeys);
    stubTiers({ wordnik: [def("thou", "ahd-5", { labels: [{ text: "Archaic" }] })] });
    expect(await body(await handler(request("thou")))).toMatchObject({
      outcome: "rejected",
      reason: "archaic",
    });
  });

  it("stays playable when only some Wordnik senses are out of use", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [
        def("cleave", "ahd-5", { labels: [{ text: "Obsolete" }] }),
        def("cleave", "ahd-5"),
      ],
      datamuse: attested("cleave"),
    });
    expect(await body(await handler(request("cleave")))).toMatchObject({ outcome: "playable" });
  });

  it("rejects a Wordnik proper noun and abbreviation by part of speech", async () => {
    withKeys(bothKeys);
    stubTiers({ wordnik: [def("dixie", "ahd-5", { partOfSpeech: "proper-noun" })] });
    expect(await body(await handler(request("dixie")))).toMatchObject({
      outcome: "rejected",
      reason: "proper-noun",
    });

    stubTiers({ wordnik: [def("mri", "ahd-5", { partOfSpeech: "abbreviation" })] });
    expect(await body(await handler(request("mri")))).toMatchObject({
      outcome: "rejected",
      reason: "abbreviation",
    });
  });

  it("ignores Wordnik definitions of a different headword, and empty stubs", async () => {
    withKeys(bothKeys);
    stubTiers({
      wordnik: [def("thalwegs", "ahd-5"), def("thalweg", "ahd-5", { text: "  " })],
    });
    expect(await body(await handler(request("thalweg")))).toMatchObject({ outcome: "unknown" });
  });

  it("rejects gibberish, which Wordnik answers with empty stub definitions", async () => {
    // Measured: /definitions for "asdfgh" is not a 404 and not an empty array --
    // it is HTTP 200 with four objects carrying no word, text or sourceDictionary
    // at all. Anything checking only whether the list is non-empty would accept
    // every string ever typed, so this is the shape most worth pinning down.
    withKeys(bothKeys);
    const stub = { citations: [], exampleUses: [], labels: [], notes: [], relatedWords: [], textProns: [] };
    stubTiers({ wordnik: [stub, stub, stub, stub] });
    expect(await body(await handler(request("asdfgh")))).toMatchObject({
      outcome: "unknown",
      source: null,
      failure: null,
    });
  });

  it("rejects a Wordnik word no frequency source attests", async () => {
    // Otherwise it lands on the unattested floor and scores a perfect 10 Legend,
    // which an AHD inflected form or idiom sense has not earned.
    withKeys(bothKeys);
    stubTiers({ wordnik: [def("thalweg", "ahd-5")], datamuse: [] });
    const rejected = await handler(request("thalweg"));
    expect(await body(rejected)).toMatchObject({
      outcome: "rejected",
      reason: "unattested",
      zipf: null,
      source: "wordnik:ahd-5",
    });
    // A settled verdict, so the CDN may keep it.
    expect(rejected.headers.get("cache-control")).toContain("s-maxage");
  });

  it("still accepts an MW word no frequency source attests", async () => {
    // The rule is Wordnik's alone: a genuine find MW vouches for keeps its floor.
    withKeys(bothKeys);
    stubTiers({ mw: [CAT], datamuse: [] });
    expect(await body(await handler(request("cat")))).toMatchObject({
      outcome: "playable",
      zipf: null,
      source: "collegiate",
    });
  });

  it("does not claim a Wordnik word is unattested when the frequency lookup broke", async () => {
    withKeys(bothKeys);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("datamuse")) return new Response("nope", { status: 500 });
      if (href.includes("wordnik")) {
        return new Response(JSON.stringify([def("thalweg", "ahd-5")]), { status: 200 });
      }
      return new Response(JSON.stringify(["suggestion"]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(request("thalweg"));
    expect(await body(response)).toMatchObject({
      outcome: "unknown",
      failure: { reason: "upstream-error", status: 500 },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("treats Wordnik's 404 as a clean miss the CDN may cache", async () => {
    withKeys(bothKeys);
    stubTiers({ wordnikStatus: 404, wordnikBody: "not found" });
    const response = await handler(request("zzzzqx"));
    expect(await body(response)).toMatchObject({ outcome: "unknown", failure: null });
    expect(response.headers.get("cache-control")).toContain("s-maxage");
  });

  it("reports a Wordnik failure as an incomplete verdict rather than an error", async () => {
    withKeys(bothKeys);
    stubTiers({ wordnikStatus: 429, wordnikBody: "Rate limit exceeded" });
    const response = await handler(request("thalweg"));
    // Not a top-level error: MW answered, so live checks stay on for the session.
    expect(await body(response)).toMatchObject({
      outcome: "unknown",
      failure: { reason: "quota-exceeded", status: 429 },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("never consults Wordnik when no key is configured", async () => {
    withKeys({ MW_COLLEGIATE_KEY: "c" });
    const fetchMock = stubTiers({ wordnik: [def("thalweg", "ahd-5")] });
    expect(await body(await handler(request("thalweg")))).toMatchObject({ outcome: "unknown" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("wordnik"))).toBe(false);
  });

  it("does not let Wordnik answer for a word MW could not be reached about", async () => {
    withKeys(bothKeys);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("wordnik")) {
        return new Response(JSON.stringify([def("thalweg", "ahd-5")]), { status: 200 });
      }
      return new Response("You have exceeded your daily request limit.", { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(request("thalweg"));
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ outcome: "error", reason: "quota-exceeded" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("wordnik"))).toBe(false);
  });
});
