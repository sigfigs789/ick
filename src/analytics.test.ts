import { afterEach, describe, expect, it, vi } from "vitest";
import { trackResultCopied, trackResultSharedOnX, trackVisit, trackVisitEngaged } from "./analytics";
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
    trackVisit(outcome({ source: null }));
    trackVisit(outcome({ source: "reddit" }));

    const sources = track.mock.calls.map((call) => (call[1] as { source: string }).source);
    expect(sources).toEqual(["share", "twitter", "direct", "reddit"]);
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

  it("attributes a share to the sharer's origin and return cohort", () => {
    localStorage.clear();
    sessionStorage.clear();
    // First-ever visit from reddit, then a return session the player shares in.
    recordVisit("?s=reddit");
    sessionStorage.clear();
    recordVisit("");

    trackResultCopied();

    expect(track).toHaveBeenCalledWith("result_copied", {
      method: "copy",
      source: "reddit",
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
      visit_type: "first",
      times_returned: 0,
      days_returned: 0,
    });
  });
});
