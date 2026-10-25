import { beforeEach, describe, expect, it } from "vitest";
import {
  BEST_WORD_NEWS_MIN_DAYS,
  bestWordNewsEverShown,
  bestWordNewsFor,
  bestWordNewsShown,
  daysPlayed,
  markBestWordNewsShown,
} from "./bestWordNews";
import { PROGRESS_PREFIX } from "./storage";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function played(key: string) {
  const date = key.split(":")[0];
  localStorage.setItem(
    PROGRESS_PREFIX + key,
    JSON.stringify({
      date,
      drop: "str",
      acceptedWords: [{ word: "string", rarity: "Common", zipf: 4 }],
      rejectedAttempts: [],
      completed: true,
    }),
  );
}

beforeEach(() => localStorage.clear());

describe("bestWordNewsFor", () => {
  it("celebrates a finder of the best word however new they are", () => {
    expect(bestWordNewsFor([OTHER, SELF], SELF, 0, false)).toBe("self");
    expect(bestWordNewsFor([SELF.toUpperCase()], SELF, 1, true)).toBe("self");
  });

  it("tells everybody else only from their fourth day played", () => {
    expect(bestWordNewsFor([OTHER], SELF, BEST_WORD_NEWS_MIN_DAYS - 1, false)).toBeNull();
    expect(bestWordNewsFor([OTHER], SELF, BEST_WORD_NEWS_MIN_DAYS, false)).toBe("other");
    expect(bestWordNewsFor([OTHER], null, 10, false)).toBe("other");
  });

  it("tells everybody else only if they have never seen the card", () => {
    expect(bestWordNewsFor([OTHER], SELF, 10, true)).toBeNull();
  });

  it("says nothing when the finders could not be read", () => {
    expect(bestWordNewsFor(null, SELF, 10, false)).toBeNull();
    expect(bestWordNewsFor([], SELF, 10, false)).toBeNull();
  });
});

describe("daysPlayed", () => {
  it("counts a day played in both modes once", () => {
    played("2026-10-20");
    played("2026-10-21");
    played("2026-10-21:freeform");
    expect(daysPlayed()).toBe(2);
  });
});

describe("the once-a-day record", () => {
  it("remembers the day it reported", () => {
    expect(bestWordNewsShown("2026-10-24")).toBe(false);
    markBestWordNewsShown("2026-10-24");
    expect(bestWordNewsShown("2026-10-24")).toBe(true);
    expect(bestWordNewsShown("2026-10-25")).toBe(false);
  });

  it("knows whether any card was ever shown", () => {
    expect(bestWordNewsEverShown()).toBe(false);
    markBestWordNewsShown("2026-10-24");
    expect(bestWordNewsEverShown()).toBe(true);
  });
});
