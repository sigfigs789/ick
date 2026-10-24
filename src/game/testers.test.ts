import { afterEach, describe, expect, it, vi } from "vitest";
import { isTester } from "./testers";

describe("isTester", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("puts everyone on a Vercel preview in the new arms", () => {
    vi.stubGlobal("location", new URL("https://ink-git-some-branch.vercel.app/"));
    expect(isTester()).toBe(true);
  });

  it("leaves an ordinary player on the real site out", () => {
    vi.stubGlobal("location", new URL("https://example.com/"));
    expect(isTester()).toBe(false);
  });
});
