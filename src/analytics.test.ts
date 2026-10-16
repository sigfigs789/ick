import { afterEach, describe, expect, it, vi } from "vitest";
import {
  trackResultCopied,
  trackRejectedAnswer,
  trackVisit,
  trackVisitEngaged,
  trackFeedbackSubmitted,
  trackFreeformVote,
  trackFreeformFeedback,
  trackModeChanged,
  trackLeaderboardOpened,
  trackLeaderboardJoined,
  trackModeAssigned,
  trackChatOpened,
  trackFoundWordsOpened,
  trackWordSuggestion,
  trackRedditArrival,
  watchFirstInteraction,
  setReporting,
  isReporting,
} from "./analytics";
import { puzzleNumber } from "./game/share";
import { FREEFORM_TRIAL_START } from "./game/mode";
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
    expect(track).toHaveBeenNthCalledWith(1, "site_visit", expected);
    // Plus what engaged it, which a guess is unless the caller says otherwise.
    expect(track).toHaveBeenNthCalledWith(2, "visit_engaged", { ...expected, via: "guess" });
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
  it("is shared by a visit's events and kept out of Vercel", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const visit = recordVisit("")!;
    expect(visit.visitId).toMatch(/^[0-9a-f-]{36}$/);
    trackVisit(visit);
    trackVisitEngaged(visit);
    for (const [, props] of track.mock.calls) expect(props).not.toHaveProperty("visit_id");
  });
});

describe("supabase mirror", () => {
  /** Install a sendBeacon jsdom doesn't have, and hand back its calls. */
  function stubBeacon(result = true) {
    const beacon = vi.fn(() => result);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    return beacon;
  }

  /**
   * The event body a beacon or fetch call carried. jsdom's Blob has no `text()`,
   * so a Blob is read the long way round.
   */
  async function payload(body: unknown): Promise<Record<string, unknown>> {
    const text =
      body instanceof Blob
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(body);
          })
        : String(body);
    return JSON.parse(text) as Record<string, unknown>;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, "sendBeacon");
  });

  it("stays quiet under test, where there is no endpoint to post to", () => {
    const beacon = stubBeacon();
    track.mockClear();
    trackLeaderboardOpened("header");
    // Vercel still gets it; only the mirror is skipped.
    expect(track).toHaveBeenCalledWith("leaderboard_opened", { from: "header", puzzle_date: LIVE_DATE });
    expect(beacon).not.toHaveBeenCalled();
  });

  it("beacons the same event it sends to Vercel", async () => {
    vi.stubEnv("MODE", "production");
    const beacon = stubBeacon();

    trackFoundWordsOpened("header");

    expect(track).toHaveBeenCalledWith("found_words_opened", { from: "header", puzzle_date: LIVE_DATE });
    const [url, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/events");
    expect(body.type).toBe("application/json");
    expect(await payload(body)).toEqual({
      name: "found_words_opened",
      props: { from: "header", puzzle_date: LIVE_DATE, player_id: null },
    });
  });

  it("mirrors a visit's id to Supabase only", async () => {
    vi.stubEnv("MODE", "production");
    const beacon = stubBeacon();
    localStorage.clear();
    sessionStorage.clear();
    const visit = recordVisit("")!;

    trackVisitEngaged(visit);

    expect(track.mock.calls[0][1]).not.toHaveProperty("visit_id");
    const [, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(await payload(body)).toMatchObject({ name: "visit_engaged", props: { visit_id: visit.visitId } });
  });

  it("stamps every mirrored event with the player it came from", async () => {
    vi.stubEnv("MODE", "production");
    localStorage.setItem("ick:player", JSON.stringify({ id: "player-1" }));
    const beacon = stubBeacon();

    trackLeaderboardOpened("results");

    // The per-player read is the point, so the id rides on the mirror...
    const [, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(await payload(body)).toEqual({
      name: "leaderboard_opened",
      props: { from: "results", puzzle_date: LIVE_DATE, player_id: "player-1" },
    });
    // ...and not on Vercel, which cannot group by it.
    expect(track).toHaveBeenCalledWith("leaderboard_opened", { from: "results", puzzle_date: LIVE_DATE });
    localStorage.clear();
  });

  it("mirrors nothing from a host with reporting off, even an event sent to it directly", () => {
    vi.stubEnv("MODE", "production");
    const beacon = stubBeacon();
    setReporting(false);
    try {
      trackLeaderboardOpened("header");
    } finally {
      setReporting(true);
    }
    expect(beacon).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch where sendBeacon is missing", async () => {
    vi.stubEnv("MODE", "production");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    trackFoundWordsOpened("header");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/events");
    expect(init.keepalive).toBe(true);
    expect(await payload(init.body)).toEqual({
      name: "found_words_opened",
      props: { from: "header", puzzle_date: LIVE_DATE, player_id: null },
    });
    vi.unstubAllGlobals();
  });

  it("keeps the event flowing to Vercel when the mirror throws", () => {
    vi.stubEnv("MODE", "production");
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("blocked by the browser");
      },
      configurable: true,
    });

    expect(() => trackLeaderboardOpened("header")).not.toThrow();
    expect(track).toHaveBeenCalledWith("leaderboard_opened", { from: "header", puzzle_date: LIVE_DATE });
  });
});

describe("counted events", () => {
  it("counts play, leaderboards, found words, opening chat and arrivals", () => {
    trackLeaderboardJoined(false);
    trackFoundWordsOpened("header");
    trackChatOpened("standard");
    trackModeAssigned({ mode: "standard", reason: "default", source: null, date: "2026-10-16" });
    expect(track).toHaveBeenCalledWith("mode_assigned", expect.objectContaining({ mode: "standard", reason: "default" }));
    expect(track).toHaveBeenCalledWith("chat_opened", expect.anything());
    expect(track).toHaveBeenCalledWith("leaderboard_joined", { rename: false });
    expect(track).toHaveBeenCalledWith("found_words_opened", { from: "header", puzzle_date: LIVE_DATE });
  });

  it("drops everything else: feedback, Freeform votes, shares and arrivals", () => {
    trackFeedbackSubmitted("a note");
    trackFreeformVote("love", "2026-09-15");
    trackFreeformFeedback("a note", "2026-09-15", "love");
    trackWordSuggestion("quixotic");
    trackRedditArrival();
    trackModeChanged("standard", "freeform");
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

  it("sends nothing to Vercel once turned off", () => {
    setReporting(false);
    trackResultCopied("standard");
    expect(track).not.toHaveBeenCalled();
  });

  it("says so, so the SDK components are never mounted", () => {
    setReporting(false);
    expect(isReporting()).toBe(false);
  });
});
