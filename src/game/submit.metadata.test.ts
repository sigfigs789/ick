import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../data/rejection-metadata.json");
  vi.resetModules();
});

describe("the lazily loaded rejection metadata", () => {
  it("names a word's reason only once the file is in", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.resetModules();
    vi.doMock("../data/rejection-metadata.json", async () => {
      await gate;
      return { default: { archaic: ["zovrq"] } };
    });
    const submit = await import("./submit");

    // Before: a bare "not-a-word", which is why the puzzle waits on
    // rejectionMetadataReady before acting on one.
    expect(submit.rejectionMetadataLoaded()).toBe(false);
    expect(submit.evaluateSubmission("zovrq", "ovr", [])).toEqual({ ok: false, reason: "not-a-word" });

    release();
    await submit.rejectionMetadataReady;
    expect(submit.rejectionMetadataLoaded()).toBe(true);
    expect(submit.evaluateSubmission("zovrq", "ovr", [])).toEqual({ ok: false, reason: "archaic" });
  });
});
