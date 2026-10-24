import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campaignSourceFromSearch,
  trackShareArrival,
  trackTwitterArrival,
  trackModeAssigned,
  trackRedditArrival,
  trackResultCopied,
  trackMerriamWebsterApproved,
  trackMerriamWebsterFailed,
  trackUnattestedScore,
  trackRejectedAnswer,
  trackVisit,
  trackVisitEngaged,
  trackFeedbackSubmitted,
  trackFreeformVote,
  trackFreeformFeedback,
  trackSessionTime,
  trackLeaderboardOpened,
  trackFoundWordsOpened,
  watchFirstInteraction,
  setReporting,
  isReporting,
} from "./analytics";
import { unattestedZipf, rarityScore } from "./game/dictionary";
import { puzzleNumber } from "./game/share";
import { FREEFORM_TRIAL_START } from "./game/mode";
import type { LiveCheck } from "./game/liveValidate";
import type { RarityInfo } from "./game/types";
import { recordVisit, type VisitOutcome } from "./game/visits";
import { APP_VERSION } from "./version";

const track = vi.hoisted(() => vi.fn());
vi.mock("./eventLog", () => ({ logEvent: track }));

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

/** The live puzzle the visit, session, share and mode events are stamped with. */
const LIVE_DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

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
      puzzle_date: LIVE_DATE,
    };
    expect(track).toHaveBeenNthCalledWith(1, "site_visit", expect.objectContaining(expected));
    // Plus what engaged it, which a guess is unless the caller says otherwise.
    expect(track).toHaveBeenNthCalledWith(2, "visit_engaged", expect.objectContaining({ ...expected, via: "guess" }));
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
  it("tags a share with the mode of the puzzle shared", () => {
    localStorage.clear();
    trackResultCopied("freeform");

    expect(track).toHaveBeenCalledWith("result_copied", expect.objectContaining({ mode: "freeform" }));
  });

  it("tags a share-link arrival with the mode the link carried", () => {
    trackShareArrival("freeform");
    trackShareArrival(null);
    trackTwitterArrival("standard");

    const withMode = (mode: string) => expect.objectContaining({ mode, puzzle_date: expect.any(String) });
    expect(track).toHaveBeenCalledWith("arrived_from_share", withMode("freeform"));
    expect(track).toHaveBeenCalledWith("arrived_from_share", withMode("none"));
    expect(track).toHaveBeenCalledWith("arrived_from_twitter", withMode("standard"));
  });

  it("records a new player's starting mode with a readable source", () => {
    trackModeAssigned({ mode: "freeform", reason: "split", source: "reddit", date: "2026-09-30" });
    trackModeAssigned({ mode: "standard", reason: "default", source: null, date: "2026-09-30" });

    expect(track).toHaveBeenCalledWith("mode_assigned", {
      mode: "freeform",
      reason: "split",
      source: "reddit",
      puzzle_date: "2026-09-30",
    });
    expect(track).toHaveBeenCalledWith("mode_assigned", expect.objectContaining({ source: "direct" }));
  });

  it("stamps a share with both the original and most-recent origin", () => {
    localStorage.clear();
    sessionStorage.clear();
    // First arrival from a Reddit link, then a return via a Twitter link.
    recordVisit("?s=r");
    sessionStorage.clear();
    recordVisit("?s=t");

    trackResultCopied("standard");

    expect(track).toHaveBeenCalledWith("result_copied", expect.objectContaining({
      method: "copy",
      mode: "standard",
      source: "reddit", // first-touch is sticky
      last_source: "twitter", // last-touch follows the most recent link
      visit_type: "returning",
      times_returned: 1,
      days_returned: 0,
      puzzle_date: LIVE_DATE,
    }));
  });

  it("labels share-link origins the same way visit events do", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("?s=t");

    trackResultCopied("freeform");

    expect(track).toHaveBeenCalledWith(
      "result_copied",
      expect.objectContaining({ source: "twitter" })
    );
  });

  it("falls back to a direct first-time cohort when no visit was recorded", () => {
    localStorage.clear();
    trackResultCopied("freeform");

    expect(track).toHaveBeenCalledWith("result_copied", expect.objectContaining({
      method: "copy",
      mode: "freeform",
      source: "direct",
      last_source: "direct",
      visit_type: "first",
      times_returned: 0,
      days_returned: 0,
      puzzle_date: LIVE_DATE,
    }));
  });
});

describe("session_time", () => {
  it("reports both halves of the session, tagged with the player's cohort", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("?s=r");

    trackSessionTime({
      sessionId: "abc",
      visibleMs: 90_000,
      totalMs: 300_000,
      segmentMs: 60_000,
      timeToFirstGuessMs: 12_000,
      fromFirstGuessMs: 78_000,
      timeToLastGuessMs: 70_000,
      guessCount: 4,
      timeToShareMs: 80_000,
      shared: true,
      guessed: true,
      looked: true,
      reportNumber: 2,
    });

    expect(track).toHaveBeenCalledWith("session_time", expect.objectContaining({
      session_id: "abc",
      visible_ms: 90_000,
      total_ms: 300_000,
      segment_ms: 60_000,
      time_to_first_guess_ms: 12_000,
      from_first_guess_ms: 78_000,
      time_to_last_guess_ms: 70_000,
      guess_count: 4,
      time_to_share_ms: 80_000,
      shared: true,
      guessed: true,
      looked: true,
      report_number: 2,
      source: "reddit",
      last_source: "reddit",
      visit_type: "first",
      times_returned: 0,
      days_returned: 0,
      puzzle_date: LIVE_DATE,
    }));
  });

  it("sends nulls, not zeros, for a session with no guess", () => {
    localStorage.clear();
    trackSessionTime({
      sessionId: "abc",
      visibleMs: 8_000,
      totalMs: 8_000,
      segmentMs: 8_000,
      timeToFirstGuessMs: null,
      fromFirstGuessMs: null,
      timeToLastGuessMs: null,
      guessCount: 0,
      timeToShareMs: null,
      shared: false,
      guessed: false,
      looked: false,
      reportNumber: 1,
    });

    expect(track).toHaveBeenCalledWith(
      "session_time",
      expect.objectContaining({
        guessed: false,
        time_to_first_guess_ms: null,
        from_first_guess_ms: null,
        time_to_last_guess_ms: null,
        guess_count: 0,
        time_to_share_ms: null,
        shared: false,
      })
    );
  });
});

describe("looking at the boards and the finds", () => {
  it("names the live puzzle on both open events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 9, 0));
    try {
      trackLeaderboardOpened("header");
      trackFoundWordsOpened("results");
    } finally {
      vi.useRealTimers();
    }
    expect(track).toHaveBeenCalledWith("leaderboard_opened", { from: "header", puzzle_date: "2026-09-29" });
    expect(track).toHaveBeenCalledWith("found_words_opened", { from: "results", puzzle_date: "2026-09-29" });
  });

  it("engages the visit once, on whichever came first", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("");

    trackFoundWordsOpened("header");
    trackLeaderboardOpened("header");

    const engaged = track.mock.calls.filter(([name]) => name === "visit_engaged");
    expect(engaged).toHaveLength(1);
    expect(engaged[0][1]).toMatchObject({ via: "found_words", visit_type: "first" });
  });
});

describe("pressing anything", () => {
  const interacted = () => track.mock.calls.filter(([name]) => name === "visit_interacted");

  it("reports the first press of a button or key once per session", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("?s=reddit");
    document.body.innerHTML = '<p id="text">words</p><button id="b"><span id="inner">Help</span></button>';
    const stop = watchFirstInteraction();
    try {
      // A click on plain text is not a press.
      document.getElementById("text")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      expect(interacted()).toHaveLength(0);

      document.getElementById("inner")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(interacted()).toHaveLength(1);
      expect(interacted()[0][1]).toMatchObject({ source: "reddit", visit_type: "first" });

      // A reload in the same session does not report it again.
      const again = watchFirstInteraction();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
      again();
      expect(interacted()).toHaveLength(1);
    } finally {
      stop();
      document.body.innerHTML = "";
    }
  });

  it("does not count closing How to play, or keys while it is open", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("");
    document.body.innerHTML =
      '<div data-not-interaction=""><button id="close">×</button></div><button id="play">Play</button>';
    const stop = watchFirstInteraction();
    try {
      document.getElementById("close")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(interacted()).toHaveLength(0);

      document.querySelector("[data-not-interaction]")!.remove();
      document.getElementById("play")!.click();
      expect(interacted()).toHaveLength(1);
    } finally {
      stop();
      document.body.innerHTML = "";
    }
  });

  it("counts a key press", () => {
    localStorage.clear();
    sessionStorage.clear();
    recordVisit("");
    const stop = watchFirstInteraction();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    stop();
    expect(interacted()).toHaveLength(1);
  });
});

describe("visit id", () => {
  it("is shared by a visit's events", () => {
    localStorage.clear();
    sessionStorage.clear();
    const visit = recordVisit("")!;
    expect(visit.visitId).toMatch(/^[0-9a-f-]{36}$/);
    trackVisit(visit);
    trackVisitEngaged(visit);
    for (const [, props] of track.mock.calls) expect(props).toHaveProperty("visit_id", visit.visitId);
  });
});

describe("campaign arrivals", () => {
  it("maps the reddit share-link code to its campaign source", () => {
    expect(campaignSourceFromSearch("?s=r")).toBe("reddit");
    expect(campaignSourceFromSearch("?s=sh")).toBe("share");
    expect(campaignSourceFromSearch("?s=sh.f")).toBe("share");
    expect(campaignSourceFromSearch("?s=t.s")).toBe("twitter");
    expect(campaignSourceFromSearch("?s=t")).toBe("twitter");
    expect(campaignSourceFromSearch("?s=other")).toBeNull();
  });

  it("records a Reddit arrival", () => {
    trackRedditArrival();
    expect(track).toHaveBeenCalledWith("arrived_from_reddit", undefined);
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
      // An ordinary approval: nothing had to be waived to bank it.
      waived: null,
    });
  });

  it("names the register a freeform-week word was banked in spite of", () => {
    // The count that says how much of the week's reach came from lifting the
    // register rules rather than from the fold going quiet.
    const check = liveCheck({ outcome: "rejected", reason: "archaic" });
    const info: RarityInfo = { zipf: check.zipf!, rarity: "Legend" };
    trackMerriamWebsterApproved("2026-09-15", "TIO", check, info, true, "archaic");

    expect(track).toHaveBeenCalledWith(
      "merriam_webster_approved",
      expect.objectContaining({ word: "borborygmus", applied: true, waived: "archaic" })
    );
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

describe("trackFeedbackSubmitted", () => {
  it("trims the note and sends all of it", () => {
    trackFeedbackSubmitted(`  ${"a".repeat(400)}  `);
    expect(track).toHaveBeenCalledWith("feedback_submitted", { feedback: "a".repeat(400) });
  });
});

describe("event extras", () => {
  it("merges a visit's id and bot signals into site_visit alone", () => {
    localStorage.clear();
    sessionStorage.clear();
    const visit = recordVisit("")!;

    trackVisit(visit);
    trackVisitEngaged(visit);

    expect(track.mock.calls[0][1]).toMatchObject({ visit_id: visit.visitId, webdriver: false, bot_ua: false });
    expect(track.mock.calls[1][1]).toHaveProperty("visit_id", visit.visitId);
    expect(track.mock.calls[1][1]).not.toHaveProperty("webdriver");
  });

  it("sends the Freeform verdict with its voter", () => {
    localStorage.setItem("ick:player", JSON.stringify({ id: "player-1" }));
    trackFreeformVote("boo", "2026-09-15");
    expect(track).toHaveBeenCalledWith("freeform_vote", { vote: "boo", date: "2026-09-15", voter: "player-1" });
    localStorage.clear();
  });

  it("still records a verdict from a browser with no id to give", () => {
    localStorage.clear();
    trackFreeformVote("love", "2026-09-15");
    expect(track).toHaveBeenCalledWith("freeform_vote", { vote: "love", date: "2026-09-15", voter: null });
  });

  it("logs nothing from a host with reporting off, feedback included", () => {
    setReporting(false);
    try {
      trackFeedbackSubmitted("a note");
      trackFreeformFeedback("a note", "2026-09-15", null);
    } finally {
      setReporting(true);
    }
    expect(track).not.toHaveBeenCalled();
  });
});

describe("answer_rejected", () => {
  // A rejection is the one play event the mode question is sharpest about:
  // Freeform refuses fewer words by design, so a refusal rate read across both
  // modes at once is two different numbers averaged into one that describes
  // neither.
  it("carries the mode the puzzle was played under", () => {
    trackRejectedAnswer(FREEFORM_TRIAL_START, "ick", "  Tabacco ");

    expect(track).toHaveBeenCalledWith("answer_rejected", {
      puzzle_date: FREEFORM_TRIAL_START,
      puzzle_number: puzzleNumber(FREEFORM_TRIAL_START),
      mode: "freeform",
      drop: "ick",
      word: "tabacco",
    });
  });

  it("reports an archived day as the mode it was actually played in", () => {
    const beforeTrial = "2026-08-18";
    trackRejectedAnswer(beforeTrial, "ICK", "Zyzzyva");

    expect(track).toHaveBeenCalledWith(
      "answer_rejected",
      expect.objectContaining({ puzzle_date: beforeTrial, mode: "standard" })
    );
  });
});

describe("a host that reports nothing", () => {
  afterEach(() => {
    // Back on, or every test after this one silently records nothing.
    setReporting(true);
  });

  it("reports by default, which is what this site relies on", () => {
    expect(isReporting()).toBe(true);
  });

  it("sends nothing once turned off", () => {
    setReporting(false);
    trackResultCopied("standard");
    expect(track).not.toHaveBeenCalled();
  });

  it("says so", () => {
    setReporting(false);
    expect(isReporting()).toBe(false);
  });
});
