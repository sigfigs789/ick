import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrivalSource, markSessionEngaged, recordVisit } from "./visits";

/** A page load in a fresh session: clear only the per-session dedupe flags. */
function newSession() {
  sessionStorage.clear();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-01-01T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("arrivalSource", () => {
  it("returns the sanitized s code", () => {
    expect(arrivalSource("?s=reddit")).toBe("reddit");
    expect(arrivalSource("?s=SH")).toBe("sh");
    expect(arrivalSource("?s=news_letter-1")).toBe("news_letter-1");
  });

  it("returns null when absent or malformed", () => {
    expect(arrivalSource("")).toBeNull();
    expect(arrivalSource("?foo=bar")).toBeNull();
    expect(arrivalSource("?s=has space")).toBeNull();
    expect(arrivalSource("?s=<script>")).toBeNull();
    expect(arrivalSource("?s=")).toBeNull();
  });

  it("caps an over-long code so the analytics dimension stays bounded", () => {
    const long = "a".repeat(100);
    expect(arrivalSource(`?s=${long}`)).toBe("a".repeat(32));
  });
});

describe("recordVisit", () => {
  it("reports the first visit and stores the source", () => {
    const outcome = recordVisit("?s=reddit");
    expect(outcome).toMatchObject({
      isFirstVisit: true,
      isNewDay: true,
      state: {
        source: "reddit",
        firstVisitDate: "2024-01-01",
        lastVisitDate: "2024-01-01",
        timesReturned: 0,
        daysReturned: 0,
      },
    });
  });

  it("ignores reloads within the same session", () => {
    expect(recordVisit("?s=reddit")).not.toBeNull();
    // No newSession(): a refresh keeps the session flag.
    expect(recordVisit("?s=reddit")).toBeNull();
  });

  it("counts a return in a new session same day without advancing days", () => {
    recordVisit("?s=reddit");
    newSession();
    const outcome = recordVisit("");
    expect(outcome).toMatchObject({
      isFirstVisit: false,
      isNewDay: false,
      state: { timesReturned: 1, daysReturned: 0, source: "reddit" },
    });
  });

  it("advances the day counter at most once per calendar day", () => {
    recordVisit("?s=reddit");

    // Two more sessions the same day: times climb, days stay.
    newSession();
    recordVisit("");
    newSession();
    let outcome = recordVisit("");
    expect(outcome).toMatchObject({ state: { timesReturned: 2, daysReturned: 0 } });

    // Next day, one session: both advance.
    vi.setSystemTime(new Date("2024-01-02T09:00:00"));
    newSession();
    outcome = recordVisit("");
    expect(outcome).toMatchObject({
      isNewDay: true,
      state: { timesReturned: 3, daysReturned: 1, lastVisitDate: "2024-01-02" },
    });
  });

  it("keeps the original source when a later visit has none", () => {
    recordVisit("?s=reddit");
    newSession();
    const outcome = recordVisit("?s=twitter");
    // Attribution stays with where they first came from.
    expect(outcome?.state.source).toBe("reddit");
  });

  it("backfills the source if the first visit had none", () => {
    recordVisit("");
    newSession();
    const outcome = recordVisit("?s=reddit");
    expect(outcome?.state.source).toBe("reddit");
  });

  it("persists counters across sessions via local storage", () => {
    recordVisit("?s=reddit");
    newSession();
    recordVisit("");
    // A brand-new day and session reads the accumulated state back from storage.
    vi.setSystemTime(new Date("2024-01-03T08:00:00"));
    newSession();
    const outcome = recordVisit("");
    expect(outcome).toMatchObject({
      state: { timesReturned: 2, daysReturned: 1, firstVisitDate: "2024-01-01" },
    });
  });
});

describe("markSessionEngaged", () => {
  it("returns this session's visit outcome once, then null", () => {
    recordVisit("?s=reddit");
    const first = markSessionEngaged();
    expect(first).toMatchObject({
      isFirstVisit: true,
      isNewDay: true,
      state: { source: "reddit", timesReturned: 0 },
    });
    expect(markSessionEngaged()).toBeNull();

    newSession();
    // recordVisit re-arms this session before the player engages again.
    recordVisit("");
    expect(markSessionEngaged()).toMatchObject({
      isFirstVisit: false,
      state: { timesReturned: 1 },
    });
  });

  it("returns null when engaged before any visit was recorded", () => {
    // No recordVisit call: nothing stashed for this session yet.
    expect(markSessionEngaged()).toBeNull();
  });
});
