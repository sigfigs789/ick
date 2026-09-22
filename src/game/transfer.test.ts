import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTransfer,
  collectTransfer,
  decodeTransfer,
  encodeTransfer,
  summarise,
  TRANSFER_VERSION,
  type TransferPayload,
} from "./transfer";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

function day(date: string, word = "crumpet") {
  return JSON.stringify({
    date,
    drop: "cr",
    acceptedWords: [{ word, rarity: "Rare", zipf: 2.1 }],
    rejectedAttempts: [],
    completed: false,
    firstWordAt: `${date}T10:00:00.000Z`,
  });
}

function seed(id: string, days: Record<string, string>, streak?: string) {
  localStorage.setItem("ick:player", JSON.stringify({ id }));
  for (const [date, raw] of Object.entries(days)) {
    localStorage.setItem(`ick:progress:${date}`, raw);
  }
  if (streak) localStorage.setItem("ick:streak", streak);
}

beforeEach(() => {
  localStorage.clear();
});

describe("collectTransfer", () => {
  it("carries the id, the streak and every stored day", () => {
    const streak = JSON.stringify({ currentStreak: 3, longestStreak: 9 });
    seed(ID, { "2026-09-18": day("2026-09-18"), "2026-09-19": day("2026-09-19") }, streak);

    const payload = collectTransfer();

    expect(payload).not.toBeNull();
    expect(payload?.id).toBe(ID);
    expect(payload?.streak).toBe(streak);
    expect(Object.keys(payload?.progress ?? {}).sort()).toEqual([
      "2026-09-18",
      "2026-09-19",
    ]);
  });

  it("leaves everything that is a fact about the browser rather than the player", () => {
    seed(ID, { "2026-09-18": day("2026-09-18") });
    localStorage.setItem("ick:seen:instructions", "1");
    localStorage.setItem("ick:visits", "12");

    const payload = collectTransfer();

    expect(JSON.stringify(payload)).not.toContain("seen:instructions");
    expect(JSON.stringify(payload)).not.toContain("visits");
  });

  it("is nothing at all on a browser that has never joined", () => {
    expect(collectTransfer()).toBeNull();
  });

  it("carries a day played in Freeform beside the same day played in Standard", () => {
    // Two modes are two saves under one date (see `progressKey`). Keying the
    // payload by date rather than by slot would drop one of them silently,
    // which is the sort of loss nobody notices until the history is gone.
    seed(ID, { "2026-09-18": day("2026-09-18") });
    localStorage.setItem("ick:progress:2026-09-18:freeform", day("2026-09-18", "crust"));

    const payload = collectTransfer();

    expect(Object.keys(payload?.progress ?? {}).sort()).toEqual([
      "2026-09-18",
      "2026-09-18:freeform",
    ]);
  });
});

describe("encode and decode", () => {
  it("round-trips a payload through a hash string", async () => {
    seed(ID, { "2026-09-18": day("2026-09-18") }, JSON.stringify({ currentStreak: 2 }));
    const payload = collectTransfer() as TransferPayload;

    const decoded = await decodeTransfer(await encodeTransfer(payload));

    expect(decoded).toEqual(payload);
  });

  it("tolerates the leading # a caller may not have stripped", async () => {
    seed(ID, {});
    const encoded = await encodeTransfer(collectTransfer() as TransferPayload);

    expect(await decodeTransfer(`#${encoded}`)).not.toBeNull();
  });

  it("compresses a long history well below the raw JSON", async () => {
    const days: Record<string, string> = {};
    for (let i = 1; i <= 28; i += 1) {
      const date = `2026-09-${String(i).padStart(2, "0")}`;
      days[date] = day(date);
    }
    seed(ID, days);
    const payload = collectTransfer() as TransferPayload;

    const encoded = await encodeTransfer(payload);

    expect(encoded.length).toBeLessThan(JSON.stringify(payload).length / 2);
  });

  it("refuses a link cut short on the way", async () => {
    seed(ID, { "2026-09-18": day("2026-09-18") });
    const encoded = await encodeTransfer(collectTransfer() as TransferPayload);

    expect(await decodeTransfer(encoded.slice(0, encoded.length - 12))).toBeNull();
  });

  it("refuses a payload from a version it does not know", async () => {
    const forged = { v: TRANSFER_VERSION + 1, id: ID, progress: {} };
    const encoded = await encodeTransfer(forged as TransferPayload);

    expect(await decodeTransfer(encoded)).toBeNull();
  });

  it("refuses anything that is not a player id", async () => {
    const forged = { v: TRANSFER_VERSION, id: "not-a-uuid", progress: {} };
    const encoded = await encodeTransfer(forged as unknown as TransferPayload);

    expect(await decodeTransfer(encoded)).toBeNull();
  });

  it("refuses a day filed under a date it does not agree with", async () => {
    // The whole reason the check exists: without it one puzzle's words could be
    // written over every date in the calendar.
    const forged = {
      v: TRANSFER_VERSION,
      id: ID,
      progress: { "2026-09-18": day("2026-01-01") },
    };
    const encoded = await encodeTransfer(forged as TransferPayload);

    expect(await decodeTransfer(encoded)).toBeNull();
  });

  it("refuses a day that is not a save at all", async () => {
    const forged = {
      v: TRANSFER_VERSION,
      id: ID,
      progress: { "2026-09-18": JSON.stringify({ date: "2026-09-18" }) },
    };
    const encoded = await encodeTransfer(forged as TransferPayload);

    expect(await decodeTransfer(encoded)).toBeNull();
  });

  it("refuses junk", async () => {
    expect(await decodeTransfer("")).toBeNull();
    expect(await decodeTransfer("2abcdef")).toBeNull();
    expect(await decodeTransfer("0!!!!!")).toBeNull();
  });
});

describe("applyTransfer", () => {
  it("makes this browser the other player", () => {
    seed(OTHER, {});
    const payload: TransferPayload = {
      v: TRANSFER_VERSION,
      id: ID,
      streak: JSON.stringify({ currentStreak: 4 }),
      progress: { "2026-09-18": day("2026-09-18") },
    };

    expect(applyTransfer(payload)).toBe(true);

    expect(JSON.parse(localStorage.getItem("ick:player") ?? "{}").id).toBe(ID);
    expect(localStorage.getItem("ick:progress:2026-09-18")).toBe(day("2026-09-18"));
    expect(localStorage.getItem("ick:streak")).toBe(payload.streak);
  });

  it("keeps a local day the payload says nothing about", () => {
    seed(OTHER, { "2026-09-01": day("2026-09-01") });

    applyTransfer({
      v: TRANSFER_VERSION,
      id: ID,
      progress: { "2026-09-18": day("2026-09-18") },
    });

    expect(localStorage.getItem("ick:progress:2026-09-01")).toBe(day("2026-09-01"));
  });

  it("takes the incoming day where both browsers played it", () => {
    seed(OTHER, { "2026-09-18": day("2026-09-18", "crust") });

    applyTransfer({
      v: TRANSFER_VERSION,
      id: ID,
      progress: { "2026-09-18": day("2026-09-18", "crumpet") },
    });

    expect(localStorage.getItem("ick:progress:2026-09-18")).toContain("crumpet");
  });
});

describe("summarise", () => {
  it("reports the span a payload covers", () => {
    const summary = summarise({
      v: TRANSFER_VERSION,
      id: ID,
      progress: {
        "2026-09-19": day("2026-09-19"),
        "2026-09-01": day("2026-09-01"),
        "2026-09-10": day("2026-09-10"),
      },
    });

    expect(summary).toEqual({ id: ID, days: 3, first: "2026-09-01", last: "2026-09-19" });
  });

  it("counts a day played both ways once", () => {
    const summary = summarise({
      v: TRANSFER_VERSION,
      id: ID,
      progress: {
        "2026-09-18": day("2026-09-18"),
        "2026-09-18:freeform": day("2026-09-18"),
      },
    });

    expect(summary.days).toBe(1);
  });

  it("says so when there is nothing but an identity", () => {
    expect(summarise({ v: TRANSFER_VERSION, id: ID, progress: {} })).toEqual({
      id: ID,
      days: 0,
      first: null,
      last: null,
    });
  });
});
