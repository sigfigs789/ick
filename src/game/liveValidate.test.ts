import { afterEach, describe, expect, it, vi } from "vitest";
import { liveValidateWord } from "./liveValidate";

function mockFetch(impl: () => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("liveValidateWord", () => {
  it("accepts a word Merriam-Webster attests as valid", async () => {
    mockFetch(() => jsonResponse({ word: "x", valid: true, reason: null }));
    expect(await liveValidateWord("x")).toEqual({ valid: true, reason: null });
  });

  it("passes through a specific disqualifying reason", async () => {
    mockFetch(() => jsonResponse({ word: "x", valid: false, reason: "archaic" }));
    expect(await liveValidateWord("x")).toEqual({ valid: false, reason: "archaic" });
  });

  it("maps a non-tag reason (not-a-word) to null so the generic message stands", async () => {
    mockFetch(() => jsonResponse({ word: "x", valid: false, reason: "not-a-word" }));
    expect(await liveValidateWord("x")).toEqual({ valid: false, reason: null });
  });

  it("returns null when the fallback is unavailable/unconfigured", async () => {
    mockFetch(() => jsonResponse({}, false, 503));
    expect(await liveValidateWord("x")).toBeNull();
  });

  it("returns null on a network error", async () => {
    mockFetch(() => Promise.reject(new Error("offline")));
    expect(await liveValidateWord("x")).toBeNull();
  });

  it("requests the word URL-encoded from the /api/validate endpoint", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ valid: true, reason: null }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await liveValidateWord("qu ex");
    expect(fetchMock).toHaveBeenCalledWith("/api/validate?word=qu%20ex");
  });
});
