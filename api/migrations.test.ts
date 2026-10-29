/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

const migrations = import.meta.glob<string>("../supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const names = Object.keys(migrations)
  .map((path) => path.split("/").pop() ?? path)
  .sort();

describe("supabase migrations", () => {
  it("each have a version of their own", () => {
    // `db push` keys the history by the leading version alone, so a second
    // file on a version production has already applied is never run: that is
    // how the idle hint's analytics_v2_experiment sat unapplied behind
    // player_handle_longer_lists and /experimentsV2 stopped loading.
    const byVersion = new Map<string, string[]>();
    for (const name of names) {
      const version = name.split("_")[0];
      byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
    }
    const shared = [...byVersion.values()].filter((files) => files.length > 1);

    expect(shared).toEqual([]);
  });

  it("define analytics_v2_experiment with the p_experiment the api passes", () => {
    // api/review.ts reads the idle hint's two experiments apart by name.
    const latest = Object.keys(migrations)
      .sort()
      .map((path) => migrations[path])
      .filter((sql) => /function public\.analytics_v2_experiment\(/.test(sql))
      .at(-1);

    expect(latest).toMatch(/p_experiment text default null/);
  });
});
