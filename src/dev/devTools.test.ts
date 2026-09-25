import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import devToolsSource from "./devTools.ts?raw";
import { DEV_TOOLS, devToolsUnlocked } from "./devTools";

/**
 * The rule this flag exists to hold: the developer affordances reach a preview
 * deploy, and reach the production one only when switched on by hand.
 *
 * Which build a bundle is cannot be observed from inside the test runner -- it
 * is a compile-time constant, and under Vitest it is always the development
 * one. So the half that can be checked here is checked here, and the half that
 * lives in the build is checked by reading the config that decides it. The
 * end-to-end proof is a build: `npm run build` hides "Reset answers" until the
 * page is opened with `?dev=1`, `VERCEL_ENV=preview npm run build` shows it.
 */
describe("DEV_TOOLS", () => {
  it("is on under the test runner, which builds as development", () => {
    expect(DEV_TOOLS).toBe(true);
  });

  it("is turned on for a preview deploy and nothing else", () => {
    // A preview build, and only a preview build, sets the variable the flag
    // reads. Production is left alone deliberately -- it is the absence of this
    // assignment that keeps the affordances out of the build players get, so a
    // widened comparison here is the thing to catch.
    expect(viteConfig).toContain(
      "if (process.env.VERCEL_ENV === 'preview') process.env.VITE_DEV_TOOLS = '1'"
    );
    expect(viteConfig.match(/VITE_DEV_TOOLS/g)).toHaveLength(1);
  });

  it("falls back to the bundler's own development flag where the variable cannot be set", () => {
    // The app (Metro) and the Devvit client bundle these same modules and
    // neither sets VITE_DEV_TOOLS, so `DEV` is what has to carry them. Pinned
    // as source rather than behaviour because the fallback cannot be exercised
    // from a build where it is already true.
    expect(devToolsSource).toMatch(
      /import\.meta\.env\.DEV \|\|\s+import\.meta\.env\.VITE_DEV_TOOLS === "1" \|\|/
    );
  });
});

describe("devToolsUnlocked", () => {
  function memoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (k) => items.get(k) ?? null,
      key: (i) => [...items.keys()][i] ?? null,
      removeItem: (k) => void items.delete(k),
      setItem: (k, v) => void items.set(k, v),
    };
  }

  it("is off with no switch ever given", () => {
    expect(devToolsUnlocked("", memoryStorage())).toBe(false);
    expect(devToolsUnlocked("?s=abc", memoryStorage())).toBe(false);
  });

  it("turns on with ?dev=1 and stays on without it", () => {
    const storage = memoryStorage();
    expect(devToolsUnlocked("?dev=1", storage)).toBe(true);
    expect(devToolsUnlocked("", storage)).toBe(true);
  });

  it("turns off again with ?dev=0", () => {
    const storage = memoryStorage();
    devToolsUnlocked("?dev=1", storage);
    expect(devToolsUnlocked("?dev=0", storage)).toBe(false);
    expect(devToolsUnlocked("", storage)).toBe(false);
  });

  it("ignores any other value", () => {
    expect(devToolsUnlocked("?dev=true", memoryStorage())).toBe(false);
  });

  it("honours the address for one load where there is no storage", () => {
    expect(devToolsUnlocked("?dev=1", null)).toBe(true);
    expect(devToolsUnlocked("", null)).toBe(false);
  });
});
