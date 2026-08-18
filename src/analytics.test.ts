import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campaignSourceFromSearch,
  trackRedditArrival,
  trackResultCopied,
  trackResultSharedOnX,
  trackMerriamWebsterApproved,
  trackMerriamWebsterFailed,
  trackUnattestedScore,
  trackVisit,
  trackVisitEngaged,
} from "./analytics";
import { unattestedZipf, rarityScore } from "./game/dictionary";
import { puzzleNumber } from "./game/share";
import type { LiveCheck } from "./game/liveValidate";
import type { RarityInfo } from "./game/types";
import { recordVisit, type VisitOutcome } from "./game/visits";
import { APP_VERSION } from "./version";

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
      app_version: APP_VERSION,
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

  it("stamps the running build on both visit events", () => {
    // Version distribution is read off these two events: they fire once per
    // session, so a count by app_version is a count of sessions per build --
    // which is what says whether an old bundle is still in circulation.
    trackVisit(outcome());
    trackVisitEngaged(outcome());

    for (const [, payload] of track.mock.calls) {
      expect(payload).toMatchObject({ app_version: APP_VERSION });
    }
    expect(typeof APP_VERSION).toBe("number");
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

function liveCheck(overrides: Partial<LiveCheck> = {}): LiveCheck {
  return {
    word: "borborygmus",
    outcome: "playable",
    reason: null,
    detail: null,
    status: null,
    zipf: 0.8351830698490437,
    pos: ["noun"],
    firstUse: "circa 1724",
    source: "collegiate",
    failure: null,
    elapsedMs: 420,
    ...overrides,
  };
}

describe("merriam-webster events", () => {
  it("reports an approved word with the rarity it was scored at", () => {
    const check = liveCheck();
    const info: RarityInfo = { zipf: check.zipf!, rarity: "Legend" };
    trackMerriamWebsterApproved("2026-08-18", "TIO", check, info, true);

    expect(track).toHaveBeenCalledWith("merriam_webster_approved", {
      puzzle_date: "2026-08-18",
      puzzle_number: puzzleNumber("2026-08-18"),
      drop: "tio",
      word: "borborygmus",
      rarity: "Legend",
      score: rarityScore(check.zipf!, "2026-08-18"),
      zipf: 0.84,
      attested: true,
      first_use: "circa 1724",
      pos: "noun",
      mw_source: "collegiate",
      elapsed_ms: 420,
      within_handoff: true,
      applied: true,
    });
  });

  it("marks a word scored from the unattested floor as unattested", () => {
    const check = liveCheck({ zipf: null, firstUse: null, pos: [] });
    trackMerriamWebsterApproved("2026-08-18", "TIO", check, {
      zipf: unattestedZipf(),
      rarity: "Legend",
    }, true);

    expect(track).toHaveBeenCalledWith(
      "merriam_webster_approved",
      expect.objectContaining({ attested: false, first_use: "unknown", pos: "unknown" })
    );
  });

  it("separates an approval that arrived too late to count", () => {
    trackMerriamWebsterApproved(
      "2026-08-18",
      "TIO",
      liveCheck({ elapsedMs: 6200 }),
      { zipf: 0.83, rarity: "Legend" },
      false
    );

    expect(track).toHaveBeenCalledWith(
      "merriam_webster_approved",
      expect.objectContaining({ applied: false, within_handoff: false, elapsed_ms: 6200 })
    );
  });

  it("names the reason a lookup failed, including a spent quota", () => {
    trackMerriamWebsterFailed(
      "2026-08-18",
      "TIO",
      liveCheck({
        outcome: "error",
        reason: "quota-exceeded",
        detail: "You have exceeded your daily request limit.",
        status: 403,
        zipf: null,
      })
    );

    expect(track).toHaveBeenCalledWith("merriam_webster_failed", {
      puzzle_date: "2026-08-18",
      puzzle_number: puzzleNumber("2026-08-18"),
      drop: "tio",
      word: "borborygmus",
      reason: "quota-exceeded",
      detail: "You have exceeded your daily request limit.",
      status: 403,
      partial: false,
      elapsed_ms: 420,
    });
  });

  it("keeps a runaway failure detail from bloating the event", () => {
    trackMerriamWebsterFailed(
      "2026-08-18",
      "TIO",
      liveCheck({ outcome: "error", reason: "upstream-error", detail: "x".repeat(500) })
    );

    const [, payload] = track.mock.calls[track.mock.calls.length - 1];
    expect((payload as { detail: string }).detail).toHaveLength(200);
  });

  it("falls back to placeholders rather than sending empty fields", () => {
    trackMerriamWebsterFailed(
      "2026-08-18",
      "TIO",
      liveCheck({ outcome: "error", reason: null, detail: null, status: null })
    );

    expect(track).toHaveBeenCalledWith(
      "merriam_webster_failed",
      expect.objectContaining({ reason: "unknown", detail: "none", status: 0 })
    );
  });
});

describe("unattested-score event", () => {
  it("reports a curated word left at the sentinel, with the stand-in score", () => {
    trackUnattestedScore(
      "2026-08-18",
      { word: "zyzzyva", zipf: unattestedZipf(), rarity: "Legend" },
      "curated"
    );

    expect(track).toHaveBeenCalledWith("unattested_score_used", {
      puzzle_date: "2026-08-18",
      puzzle_number: puzzleNumber("2026-08-18"),
      word: "zyzzyva",
      source: "curated",
      score: 10,
      rarity: "Legend",
    });
  });

  it("separates a live approval no frequency source attested", () => {
    trackUnattestedScore(
      "2026-08-18",
      { word: "borborygmus", zipf: unattestedZipf(), rarity: "Legend" },
      "live"
    );

    expect(track).toHaveBeenCalledWith(
      "unattested_score_used",
      expect.objectContaining({ source: "live", word: "borborygmus" })
    );
  });

  it("reports the stand-in an older puzzle's own scoring system substitutes", () => {
    trackUnattestedScore(
      "2026-08-15",
      { word: "zyzzyva", zipf: unattestedZipf(), rarity: "Mythic" },
      "curated"
    );

    // Same bucket whatever the archive puzzle's system says: the rank differs
    // (Mythic before the Legend tier), but the score is still a stand-in.
    expect(track).toHaveBeenCalledWith(
      "unattested_score_used",
      expect.objectContaining({ score: rarityScore(unattestedZipf(), "2026-08-15") })
    );
  });
});
