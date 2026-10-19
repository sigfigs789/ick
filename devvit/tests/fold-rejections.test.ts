/**
 * The website's live fold rejections, imported so a Reddit player is priced the
 * same as a website player on the board the two share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./redis-fake";

const redis = new FakeRedis();
const settings = {
  get: vi.fn(async (name: string) =>
    name === "supabaseUrl" ? "https://example.supabase.co" : "anon-key"
  ),
};

vi.mock("@devvit/web/server", () => ({ redis, settings }));

const { importFoldRejections, importedFoldRejections } = await import(
  "../src/server/core/import"
);

const WED = "2026-07-08";

beforeEach(() => {
  Object.assign(redis, new FakeRedis());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importing live fold rejections", () => {
  it("asks the anon-callable function for one puzzle and caches the pairs", async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        { word: "timelinesses", base: "time" },
        { word: "", base: 3 },
      ])
    );
    vi.stubGlobal("fetch", fetch);

    expect(await importFoldRejections(WED)).toBe(1);
    expect(await importedFoldRejections(WED)).toEqual([{ word: "timelinesses", base: "time" }]);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/list_live_fold_rejections_public");
    expect(JSON.parse(String(init.body))).toEqual({ p_date: WED });
  });

  it("keeps the last import when the website cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ word: "zarfs", base: "zarf" }])));
    await importFoldRejections(WED);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("PERMISSION_DENIED");
      })
    );
    expect(await importFoldRejections(WED)).toBe(0);
    expect(await importedFoldRejections(WED)).toEqual([{ word: "zarfs", base: "zarf" }]);
  });

  it("answers an empty list for a puzzle nothing has been imported for", async () => {
    expect(await importedFoldRejections(WED)).toEqual([]);
  });
});
