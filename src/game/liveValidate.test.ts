import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkWordLive,
  eligibleForLiveCheck,
  LIVE_HANDOFF_MS,
  rejectionReasonForLive,
  STILL_PENDING,
  withHandoff,
  type LiveCheck,
} from "./liveValidate";

function stubResponse(body: unknown, status = 200, valid = true) {
  const fetchMock = vi.fn(
    async () =>
      ({
        status,
        json: async () => {
          if (!valid) throw new Error("not json");
          return body;
        },
      }) as unknown as Response
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function check(overrides: Partial<LiveCheck> = {}): LiveCheck {
  return {
    word: "x",
    outcome: "rejected",
    reason: null,
    detail: null,
    status: null,
    zipf: null,
    pos: [],
    firstUse: null,
    elapsedMs: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("eligibleForLiveCheck", () => {
  it("accepts plain lowercase words of playable length", () => {
    expect(eligibleForLiveCheck("zymurgy")).toBe(true);
    expect(eligibleForLiveCheck("gastroenterologist")).toBe(true);
  });

  it("spends no quota on input the game would never accept", () => {
    expect(eligibleForLiveCheck("a")).toBe(false);
    expect(eligibleForLiveCheck("two words")).toBe(false);
    expect(eligibleForLiveCheck("abc3")).toBe(false);
    expect(eligibleForLiveCheck("z".repeat(31))).toBe(false);
  });
});

describe("checkWordLive connection gate", () => {
  it("makes no request at all when the player is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = stubResponse({});
    const result = await checkWordLive("zymurgy");
    expect(result.outcome).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkWordLive parsing", () => {
  it("passes through a playable verdict with its frequency", async () => {
    stubResponse({
      word: "zymurgy",
      outcome: "playable",
      reason: null,
      zipf: 0.198,
      pos: ["noun"],
      firstUse: "1868",
    });
    const result = await checkWordLive("Zymurgy");
    expect(result).toMatchObject({
      word: "zymurgy",
      outcome: "playable",
      zipf: 0.198,
      pos: ["noun"],
      firstUse: "1868",
    });
  });

  it("reads the failure reason out of a non-2xx body", async () => {
    stubResponse(
      { word: "cat", outcome: "error", reason: "quota-exceeded", detail: "limit", status: 403 },
      502
    );
    expect(await checkWordLive("cat")).toMatchObject({
      outcome: "error",
      reason: "quota-exceeded",
      detail: "limit",
      status: 403,
    });
  });

  it("reports an unparsable body as a client-side failure", async () => {
    stubResponse(null, 502, false);
    expect(await checkWordLive("cat")).toMatchObject({
      outcome: "error",
      reason: "client-bad-response",
    });
  });

  it("reports an unrecognized outcome rather than trusting it", async () => {
    stubResponse({ word: "cat", outcome: "definitely-fine" });
    expect(await checkWordLive("cat")).toMatchObject({
      outcome: "error",
      reason: "client-bad-response",
    });
  });

  it("reports a network failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      })
    );
    expect(await checkWordLive("cat")).toMatchObject({
      outcome: "error",
      reason: "client-network-error",
      detail: "Failed to fetch",
    });
  });

  it("drops a non-numeric zipf instead of scoring from it", async () => {
    stubResponse({ word: "cat", outcome: "playable", zipf: "very rare" });
    expect((await checkWordLive("cat")).zipf).toBeNull();
  });
});

describe("rejectionReasonForLive", () => {
  it("uses MW's specific reason when the game has wording for it", () => {
    expect(rejectionReasonForLive(check({ outcome: "rejected", reason: "archaic" }))).toBe("archaic");
    expect(rejectionReasonForLive(check({ outcome: "rejected", reason: "proper-noun" }))).toBe(
      "proper-noun"
    );
  });

  it("falls back to the generic reason rather than inventing copy", () => {
    // "offensive" is a real verdict with no player-facing message of its own.
    expect(rejectionReasonForLive(check({ outcome: "rejected", reason: "offensive" }))).toBe(
      "not-a-word"
    );
    expect(rejectionReasonForLive(check({ outcome: "unknown" }))).toBe("not-a-word");
    expect(rejectionReasonForLive(check({ outcome: "error", reason: "quota-exceeded" }))).toBe(
      "not-a-word"
    );
  });
});

describe("withHandoff", () => {
  it("returns the value when it arrives inside the window", async () => {
    await expect(withHandoff(Promise.resolve("done"), 50)).resolves.toBe("done");
  });

  it("stops waiting past the window but leaves the promise running", async () => {
    let settle: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      settle = resolve;
    });
    expect(await withHandoff(slow, 10)).toBe(STILL_PENDING);

    // The handoff must not cancel the work -- the same promise still resolves.
    settle("late");
    await expect(slow).resolves.toBe("late");
  });

  it("hands off rather than surfacing a rejection to the caller", async () => {
    const failing = Promise.reject(new Error("boom"));
    expect(await withHandoff(failing, 10)).toBe(STILL_PENDING);
  });

  it("defaults to the one-second player-facing budget", () => {
    expect(LIVE_HANDOFF_MS).toBe(1000);
  });
});
