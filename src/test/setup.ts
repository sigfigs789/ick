import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach } from "vitest";
import { forgetPageCaches } from "../game/pageCache";

// jsdom doesn't implement the Clipboard API's image-write pieces
// (ClipboardItem itself is missing entirely). A minimal stub is enough for
// anything that just constructs one and passes it to clipboard.write().
if (!("ClipboardItem" in globalThis)) {
  class ClipboardItemStub {
    types: string[];
    constructor(items: Record<string, Blob>) {
      this.types = Object.keys(items);
    }
  }
  // @ts-expect-error -- test-only polyfill, not a full spec implementation
  globalThis.ClipboardItem = ClipboardItemStub;
}

// The paged views remember what they read for the life of the module (see
// game/pageCache.ts); a test must not open on rows another test put there.
beforeEach(() => forgetPageCaches());

// The game fetches part of its scoring data after it starts (see `scoringReady`
// in game/dictionary.ts) and waits for it before scoring anything. Tests score
// words directly, so every file starts with all of it in -- the legacy rarity
// included, by asking for a puzzle old enough to need it. Imported here rather
// than at the top so a file that mocks the dictionary gets its own mock, which
// may not carry the export.
beforeAll(async () => {
  const dictionary = await import("../game/dictionary");
  if (typeof dictionary.scoringReady === "function") await dictionary.scoringReady("2026-08-01");
});
