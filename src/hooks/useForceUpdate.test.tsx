import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForceUpdate } from "./useForceUpdate";

// The running tab always reports APP_VERSION = 1; each test drives behavior by
// varying the minVersion that version.json returns.
vi.mock("../version", () => ({ APP_VERSION: 1 }));

const reload = vi.fn();

// Resolve version.json as { minVersion }. Pass a partial to simulate a
// malformed/HTML response, or { ok: false } for a 404, or reject for offline.
function mockVersion(
  body: unknown,
  { ok = true, reject = false }: { ok?: boolean; reject?: boolean } = {},
) {
  const fetchMock = vi.fn(() =>
    reject
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ ok, json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Let the in-flight checkVersion() promise chain settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  reload.mockClear();
  vi.stubGlobal("location", { reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useForceUpdate", () => {
  it("reloads on mount when below the required floor", async () => {
    mockVersion({ minVersion: 2 });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when at the floor", async () => {
    mockVersion({ minVersion: 1 });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when above the floor", async () => {
    mockVersion({ minVersion: 0 });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload on a 404 (fails closed)", async () => {
    mockVersion({ minVersion: 2 }, { ok: false });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the body isn't the expected shape", async () => {
    // e.g. the SPA rewrite served index.html and JSON parsing yields no number.
    mockVersion({ notMinVersion: true });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when offline (fetch rejects)", async () => {
    mockVersion(null, { reject: true });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("re-checks and reloads when the tab is foregrounded", async () => {
    mockVersion({ minVersion: 2 });
    renderHook(() => useForceUpdate());
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
