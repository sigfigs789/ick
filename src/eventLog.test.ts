import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./eventLog";
import { resetVisitorTagForTest, visitorTag } from "./game/visitor";

/** Install a sendBeacon jsdom doesn't have, and hand back its calls. */
function stubBeacon(result = true) {
  const beacon = vi.fn(() => result);
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  return beacon;
}

/**
 * The event body a beacon or fetch call carried. jsdom's Blob has no `text()`,
 * so a Blob is read the long way round.
 */
async function payload(body: unknown): Promise<Record<string, unknown>> {
  const text =
    body instanceof Blob
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(body);
        })
      : String(body);
  return JSON.parse(text) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "sendBeacon");
  localStorage.clear();
});

describe("logEvent", () => {
  it("stays quiet under test, where there is no endpoint to post to", () => {
    const beacon = stubBeacon();
    logEvent("word_suggested", { word: "quixotic" });
    expect(beacon).not.toHaveBeenCalled();
  });

  it("beacons the event to /api/events", async () => {
    vi.stubEnv("MODE", "production");
    const beacon = stubBeacon();

    logEvent("word_suggested", { word: "quixotic" });

    const [url, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/events");
    expect(body.type).toBe("application/json");
    expect(await payload(body)).toEqual({
      name: "word_suggested",
      props: { word: "quixotic", player_id: null },
    });
  });

  it("stamps every event with the player it came from", async () => {
    vi.stubEnv("MODE", "production");
    localStorage.setItem("ick:player", JSON.stringify({ id: "player-1" }));
    const beacon = stubBeacon();

    logEvent("mode_changed", { from: "standard", to: "freeform" });

    const [, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(await payload(body)).toEqual({
      name: "mode_changed",
      props: { from: "standard", to: "freeform", player_id: "player-1" },
    });
  });

  it("tags every event from a known visitor", async () => {
    vi.stubEnv("MODE", "production");
    const beacon = stubBeacon();
    visitorTag("?visitor=mos-muse");

    logEvent("word_suggested", { word: "quixotic" });

    const [, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(await payload(body)).toMatchObject({ props: { visitor: "mos-muse" } });
    resetVisitorTagForTest();
  });

  it("falls back to a keepalive fetch where sendBeacon is missing", async () => {
    vi.stubEnv("MODE", "production");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    logEvent("arrived_from_reddit");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/events");
    expect(init.keepalive).toBe(true);
    // An event with no properties of its own still says whose it was.
    expect(await payload(init.body)).toEqual({
      name: "arrived_from_reddit",
      props: { player_id: null },
    });
  });

  it("never throws, even when the browser refuses the beacon", () => {
    vi.stubEnv("MODE", "production");
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("blocked by the browser");
      },
      configurable: true,
    });
    expect(() => logEvent("arrived_from_reddit")).not.toThrow();
  });
});
