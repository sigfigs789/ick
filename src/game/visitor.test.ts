import { afterEach, describe, expect, it } from "vitest";
import { resetVisitorTagForTest, visitorTag } from "./visitor";

afterEach(() => {
  localStorage.clear();
  resetVisitorTagForTest();
});

describe("visitorTag", () => {
  it("is null for a player", () => {
    expect(visitorTag("")).toBeNull();
    expect(visitorTag("?s=sh")).toBeNull();
  });

  it("reads the tag off the URL", () => {
    expect(visitorTag("?visitor=mos-muse")).toBe("mos-muse");
    expect(visitorTag("?s=r&visitor=MOS-Muse")).toBe("mos-muse");
  });

  it("keeps the tag once the URL has dropped it, a later visit included", () => {
    visitorTag("?visitor=mos-muse");
    expect(visitorTag("")).toBe("mos-muse");
    // A fresh page load reads it back out of storage.
    resetVisitorTagForTest();
    expect(visitorTag("")).toBe("mos-muse");
  });

  it("ignores a tag that is not a plain token", () => {
    expect(visitorTag("?visitor=%3Cscript%3E")).toBeNull();
    expect(visitorTag(`?visitor=${"a".repeat(33)}`)).toBeNull();
    expect(localStorage.getItem("ick:visitor")).toBeNull();
  });
});
