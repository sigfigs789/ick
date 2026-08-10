import "@testing-library/jest-dom/vitest";

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
