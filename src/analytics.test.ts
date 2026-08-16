import { afterEach, describe, expect, it, vi } from "vitest";
import { trackVisit, trackVisitEngaged } from "./analytics";
import type { VisitOutcome } from "./game/visits";

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
