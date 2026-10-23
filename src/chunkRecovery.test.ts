import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installChunkRecovery } from "./chunkRecovery";

const reload = vi.fn();

/** What Vite's build fires on window when a dynamic import fails. */
function preloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeAll(() => installChunkRecovery());

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installChunkRecovery", () => {
  it("reloads the tab when a chunk fails to arrive, and swallows the error", () => {
    const event = preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets a second failure through rather than reloading in a loop", () => {
    sessionStorage.setItem("ick:chunk-reload-at", String(Date.now()));
    const event = preloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reloads again once the guard window has passed", () => {
    sessionStorage.setItem("ick:chunk-reload-at", String(Date.now() - 60_000));
    expect(preloadError().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
