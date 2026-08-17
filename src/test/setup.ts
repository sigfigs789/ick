import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom doesn't implement matchMedia. Default to a non-hover ("touch") match so
// components that branch on "(hover: hover)" have something to call; tests that
// exercise hover behaviour override this per-case.
if (!("matchMedia" in globalThis)) {
  globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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
