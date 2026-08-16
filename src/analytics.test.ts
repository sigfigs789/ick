import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campaignSourceFromSearch,
  trackRedditArrival,
  trackResultCopied,
  trackResultSharedOnX,
  trackVisit,
  trackVisitEngaged,
} from "./analytics";
import { recordVisit, type VisitOutcome } from "./game/visits";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

afterEach(() => {
  track.mockClear();
});

function outcome(overrides: Partial<VisitOutcome["state"]> = {}, rest: Partial<VisitOutcome> = {}): VisitOutcome {
  return {
    isFirstVisit: false,
    isNewDay: true,
    state: {
      source: "reddit",
      lastSource: "t",
      firstVisitDate: "2024-01-01",
      lastVisitDate: "2024-01-03",
      timesReturned: 2,
      daysReturned: 1,
      ...overrides,
    },
    ...rest,
  };
}

describe("visit events", () => {
  it("site_visit and visit_engaged carry identical params", () => {
    const o = outcome();
    trackVisit(o);
    trackVisitEngaged(o);

    const expected = {
      visit_type: "returning",
      source: "reddit",
      last_source: "twitter",
      times_returned: 2,
      days_returned: 1,
      new_day: true,
    };
    expect(track).toHaveBeenNthCalledWith(1, "site_visit", expected);
    expect(track).toHaveBeenNthCalledWith(2, "visit_engaged", expected);
  });

  it("maps share-link codes to readable source labels", () => {
    trackVisit(outcome({ source: "sh" }));
    trackVisit(outcome({ source: "t" }));
    trackVisit(outcome({ source: "r" }));
    trackVisit(outcome({ source: null }));
    trackVisit(outcome({ source: "reddit" }));

    const sources = track.mock.calls.map((call) => (call[1] as { source: string }).source);
    expect(sources).toEqual(["share", "twitter", "reddit", "direct", "reddit"]);
  });

  it("passes an unrecognized s code through verbatim", () => {
    trackVisit(outcome({ source: "z" }));
    trackVisit(outcome({ source: "newsletter" }));

    const sources = track.mock.calls.map((call) => (call[1] as { source: string }).source);
    expect(sources).toEqual(["z", "newsletter"]);
  });

  it("tags a first-ever visit", () => {
    trackVisit(outcome({ timesReturned: 0 }, { isFirstVisit: true }));
    expect(track).toHaveBeenCalledWith(
      "site_visit",
      expect.objectContaining({ visit_type: "first" })
    );
  });
});

describe("share attribution", () => {
  it("tracks copied results separately from X shares, tagged by method", () => {
    localStorage.clear();
    trackResultCopied();
    trackResultSharedOnX();

    expect(track).toHaveBeenCalledWith("result_copied", expect.objectContaining({ method: "copy" }));
    expect(track).toHaveBeenCalledWith("result_shared_on_x", expect.objectContaining({ method: "x" }));
  });

  it("stamps a share with both the original and most-recent origin", () => {
    localStorage.clear();
    sessionStorage.clear();
    // First arrival from a Reddit link, then a return via a Twitter link.
    recordVisit("?s=r");
    sessionStorage.clear();
    recordVisit("?s=t");

    trackResultCopied();

    expect(track).toHaveBeenCalledWith("result_copied", {
      method: "copy",
      source: "reddit", // first-touch is sticky
      last_source: "twitter", // last-touch follows the most recent link
      visit_type: "returning",
      times_returned: 1,
      days_returned: 0,
    });
  });

  it("labels share-link origins the same way visit events do", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("?s=t");

    trackResultSharedOnX();

    expect(track).toHaveBeenCalledWith(
      "result_shared_on_x",
      expect.objectContaining({ source: "twitter" })
    );
  });

  it("falls back to a direct first-time cohort when no visit was recorded", () => {
    localStorage.clear();
    trackResultSharedOnX();

    expect(track).toHaveBeenCalledWith("result_shared_on_x", {
      method: "x",
      source: "direct",
      last_source: "direct",
      visit_type: "first",
      times_returned: 0,
      days_returned: 0,
    });
  });
});

describe("campaign arrivals", () => {
  it("maps the reddit share-link code to its campaign source", () => {
    expect(campaignSourceFromSearch("?s=r")).toBe("reddit");
    expect(campaignSourceFromSearch("?s=sh")).toBe("share");
    expect(campaignSourceFromSearch("?s=t")).toBe("twitter");
    expect(campaignSourceFromSearch("?s=other")).toBeNull();
  });

  it("records a Reddit arrival", () => {
    trackRedditArrival();
    expect(track).toHaveBeenCalledWith("arrived_from_reddit");
  });
});
