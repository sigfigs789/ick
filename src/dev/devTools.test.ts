import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import devToolsSource from "./devTools.ts?raw";
import { DEV_TOOLS } from "./devTools";

/**
 * The rule this flag exists to hold: the developer affordances reach a preview
 * deploy and never the production one.
 *
 * Which build a bundle is cannot be observed from inside the test runner -- it
 * is a compile-time constant, and under Vitest it is always the development
 * one. So the half that can be checked here is checked here, and the half that
 * lives in the build is checked by reading the config that decides it. The
 * end-to-end proof is a build: `npm run build` leaves no "Reset answers" in
 * dist, `VERCEL_ENV=preview npm run build` puts it there.
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
    expect(devToolsSource).toContain("import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === \"1\"");
  });
});
