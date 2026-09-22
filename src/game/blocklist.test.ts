// The blocklist is a reviewed list kept in a text file and a generated JSON
// copy the client imports. This is what holds the two together: the text file is
// where a human adds an entry, and nothing in the build fails if the JSON is
// stale, so the only thing standing between "added to blocklist.txt" and "still
// playable" is this test.
import { describe, expect, it } from "vitest";
import { evaluateSubmission } from "./submit";
import { blocklistSize, isBlocked } from "./blocklist";
import { eligibleForLiveCheck } from "./liveValidate";
import blocklistData from "../data/blocklist.json";
// Through Vite's ?raw, as dictionary.test.ts reads its own text list: the repo
// installs no Node types, so the file cannot be read with fs.
import blocklistSource from "../../scripts/blocklist.txt?raw";

/** scripts/blocklist.txt, parsed exactly as load_blocklist in generate-data.py. */
function parseBlocklistSource(): string[] {
  return blocklistSource
    .split("\n")
    .map((line) => line.split("#")[0].trim().toLowerCase())
    .filter((word) => word.length > 0)
    .sort();
}

describe("the shipped blocklist", () => {
  it("holds exactly what scripts/blocklist.txt lists", () => {
    expect([...(blocklistData as string[])].sort()).toEqual(parseBlocklistSource());
  });

  it("keeps the entries that carry a trailing note", () => {
    // Both loaders used to read the line whole, so an entry with a note beside
    // it became a string no word could equal and was silently never applied.
    expect(isBlocked("niggardly")).toBe(true);
    expect(isBlocked("tormentatious")).toBe(true);
    expect(blocklistSize()).toBe(36);
  });
});

describe("a blocked word is unplayable by every route", () => {
  // "niggardly" is the case that matters: it is on the blocklist, it is in the
  // curated dictionary, and Merriam-Webster carries it -- so it had to be
  // refused ahead of both, not by either of them.
  it("is refused even though the curated dictionary carries it", () => {
    const result = evaluateSubmission("niggardly", "gar", [], "2026-09-28");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-a-word");
  });

  it("is never sent to the live lookup", () => {
    expect(eligibleForLiveCheck("niggardly")).toBe(false);
    expect(eligibleForLiveCheck("ordinary")).toBe(true);
  });
});
