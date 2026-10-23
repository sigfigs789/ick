/**
 * End-to-end gameplay through the real UI.
 *
 * Everything below drives the actual <App /> with the real hook, the real
 * dictionary and the real localStorage-backed storage layer -- the only stubs
 * are the network (so no test ever depends on Merriam-Webster being reachable)
 * and Vercel's analytics/insights widgets. The unit tests around
 * useDailyPuzzle cover the hook in isolation; these cover the wiring between
 * the hook, storage and the components a player actually touches, which is
 * where a regression can hide with every unit test still green.
 *
 * Words are chosen from the dictionary at runtime rather than hard-coded,
 * because the drop rotates daily and today's puzzle is whatever the calendar
 * says it is.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { addDays, formatDateLabel, todayDateString } from "./game/date";
import { maxGuessesFor } from "./game/constants";
import { dropForDate } from "./game/drop";
import { evaluateSubmission } from "./game/submit";
import { resetLiveCheckSession } from "./game/liveValidate";
import { markSeen } from "./game/whatsNew";
import dictionaryWords from "./data/dictionary.json";
import type { AcceptedWord, DailyProgress } from "./game/types";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/react", () => ({ SpeedInsights: () => null }));

const TODAY = todayDateString();
const YESTERDAY = addDays(TODAY, -1);
const DROP = dropForDate(TODAY);
/**
 * Today's guess limit, read from the same function the app reads it from.
 *
 * The limit steps down on fixed dates (game/constants.ts), so a literal here is
 * a test that passes until the calendar reaches the next step and then fails
 * for a reason that has nothing to do with the code under test -- which is
 * exactly what happened when the 5 -> 4 step landed. Deriving it keeps these
 * tests about the wiring between the hook, storage and the form, and lets the
 * constants' own tests own the schedule.
 */
const LIMIT = maxGuessesFor(TODAY);

/**
 * `count` words that are playable in a single sitting for `drop`: each one
 * clears every rule *given the ones before it*, so no pick is refused later as
 * a duplicate or a same-root repeat of an earlier one.
 */
function playableWords(count: number, drop: string, date: string): string[] {
  const accepted: AcceptedWord[] = [];
  const picked: string[] = [];
  for (const word of dictionaryWords as unknown as string[]) {
    if (picked.length === count) break;
    if (!word.includes(drop.toLowerCase())) continue;
    const result = evaluateSubmission(word, drop, accepted, date);
    if (!result.ok || !result.word) continue;
    accepted.push(result.word);
    picked.push(word);
  }
  if (picked.length < count) {
    throw new Error(`only ${picked.length} of ${count} playable words for "${drop}" on ${date}`);
  }
  return picked;
}

/** A guess that clears every offline rule but is on no curated list, so it is
 * the one case that reaches the live fallback. */
const OFF_LIST_WORD = `${DROP.toLowerCase()}qxz`;

/** The saved progress for `date`, straight out of localStorage. */
function savedProgress(date: string): DailyProgress | null {
  const raw = localStorage.getItem(`ick:progress:${date}`);
  return raw ? (JSON.parse(raw) as DailyProgress) : null;
}

/**
 * Answer both endpoints the app talks to: /version.json (polled on mount by
 * useForceUpdate) and /api/validate. The validate verdict is "not found" by
 * default, so an off-list guess resolves promptly and offline instead of
 * hanging on a real request.
 */
function stubFetch(validateBody?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("version.json")) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return {
      status: 200,
      // Same-origin JSON, i.e. the request reached the function rather than
      // being intercepted (see the auth-redirect guard in liveValidate).
      url: `${location.origin}/api/validate`,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () =>
        validateBody ?? {
          word: OFF_LIST_WORD,
          outcome: "not-found",
          reason: null,
          zipf: null,
          pos: [],
          firstUse: null,
        },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Type `word` into the puzzle input and submit it. */
async function submit(word: string) {
  const input = screen.getByLabelText(/enter a word containing/i);
  await userEvent.type(input, word);
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
}

/** The guess log's list entries, in order, as their word text. */
function loggedWords(): string[] {
  const log = screen.getByRole("region", { name: /your guesses/i });
  return within(log)
    .queryAllByRole("listitem")
    .map((entry) => entry.querySelector(".guess-log__word")?.textContent ?? "");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // These cover gameplay, not the welcome: without this the cleared storage
  // makes every render a first visit, and the rules open over the puzzle.
  markSeen("instructions");
  resetLiveCheckSession();
  track.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gameplay end to end", () => {
  it("banks a curated word into the log, the streak and localStorage", async () => {
    const [word] = playableWords(1, DROP, TODAY);
    render(<App />);

    expect(screen.getByText(/no words yet/i)).toBeInTheDocument();
    await submit(word);

    await waitFor(() => expect(loggedWords()).toEqual([word]));
    expect(screen.getByText(new RegExp(`1 of ${LIMIT} guesses`, "i"))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`"${word}" accepted`, "i"));
    // The first word of the day advances the streak, which the display reads
    // out of storage rather than from the submission itself.
    expect(screen.getByLabelText(/current streak: 1 days/i)).toBeInTheDocument();

    const saved = savedProgress(TODAY);
    expect(saved?.drop).toBe(DROP);
    expect(saved?.acceptedWords.map((w) => w.word)).toEqual([word]);
    expect(saved?.completed).toBe(false);
  });

  it("restores a puzzle in progress after a reload", async () => {
    const [word] = playableWords(1, DROP, TODAY);
    const first = render(<App />);
    await submit(word);
    await waitFor(() => expect(loggedWords()).toEqual([word]));
    first.unmount();

    render(<App />);

    expect(loggedWords()).toEqual([word]);
    expect(screen.getByText(new RegExp(`1 of ${LIMIT} guesses`, "i"))).toBeInTheDocument();
    // Still playable: a restored puzzle picks up mid-game, not finished.
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("explains a rejected guess and leaves the log untouched", async () => {
    render(<App />);

    await submit("aeiou".includes(DROP.toLowerCase()) ? "qwrtp" : "aeiou");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/missing the drop/i)
    );
    expect(loggedWords()).toEqual([]);
    expect(savedProgress(TODAY)?.rejectedAttempts).toHaveLength(1);
  });

  it("refuses a word already banked this puzzle", async () => {
    const [word] = playableWords(1, DROP, TODAY);
    render(<App />);

    await submit(word);
    await waitFor(() => expect(loggedWords()).toEqual([word]));
    await submit(word);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/already used/i)
    );
    expect(loggedWords()).toEqual([word]);
  });

  it("finishes the puzzle at the guess limit and takes the form away", async () => {
    const words = playableWords(LIMIT, DROP, TODAY);
    render(<App />);

    for (const word of words) {
      await submit(word);
      await waitFor(() => expect(loggedWords()).toContain(word));
    }

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(loggedWords()).toEqual(words);
    const saved = savedProgress(TODAY);
    expect(saved?.completed).toBe(true);
    expect(saved?.completedAt).toBeTruthy();
  });

  it("offers Share from the first word, without ending the puzzle", async () => {
    const [word] = playableWords(1, DROP, TODAY);
    render(<App />);

    // Nothing to share before there is a word.
    expect(screen.queryByRole("button", { name: /^share$/i })).not.toBeInTheDocument();
    await submit(word);
    await waitFor(() => expect(loggedWords()).toEqual([word]));

    // Share arrives and the form stays: sharing used to require pressing
    // "I'm done guessing", which finished the day for good.
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(savedProgress(TODAY)?.completed).toBe(false);
  });

  it("offers yesterday's best word under the drop before any answer", () => {
    render(<App />);

    // Straight after the drop, not down under the guesses, and with nothing
    // banked yet: it never waits on the player.
    expect(document.querySelector(".puzzle-nav--drop + .yesterdays-best")).toHaveTextContent(
      "Yesterday's Best Word",
    );
    fireEvent.click(screen.getByRole("button", { name: "Yesterday's Best Word" }));
    expect(document.querySelector(".yesterdays-best__word")).toBeInTheDocument();
    expect(document.querySelectorAll(".yesterdays-best")).toHaveLength(1);
    expect(loggedWords()).toEqual([]);
  });

  it("finishes a puzzle without handing over its own best word", async () => {
    // The word of the day is gone; the best word on show is yesterday's best
    // find (see YesterdaysBest), which spoils nothing about today's puzzle.
    const words = playableWords(LIMIT, DROP, TODAY);
    render(<App />);

    for (const word of words) {
      await submit(word);
      await waitFor(() => expect(loggedWords()).toContain(word));
    }

    await waitFor(() => expect(savedProgress(TODAY)?.completed).toBe(true));
    expect(screen.queryByRole("button", { name: "Word of the day" })).not.toBeInTheDocument();
    expect(document.querySelector(".drop-display__ceiling-word")).not.toBeInTheDocument();
    expect(savedProgress(TODAY)?.retryUsed).toBeFalsy();
  });

  it("keeps an archived puzzle's progress separate from today's", async () => {
    const yesterdayDrop = dropForDate(YESTERDAY);
    const [todayWord] = playableWords(1, DROP, TODAY);
    const [yesterdayWord] = playableWords(1, yesterdayDrop, YESTERDAY);
    render(<App />);

    await submit(todayWord);
    await waitFor(() => expect(loggedWords()).toEqual([todayWord]));

    await userEvent.click(screen.getByRole("button", { name: /previous puzzle/i }));

    expect(screen.getByText(`${formatDateLabel(YESTERDAY)}'s drop`)).toBeInTheDocument();
    expect(screen.queryByText(/Puzzle #/)).not.toBeInTheDocument();
    expect(screen.getByText(/playing an old puzzle/i)).toBeInTheDocument();
    expect(loggedWords()).toEqual([]);

    await submit(yesterdayWord);
    await waitFor(() => expect(loggedWords()).toEqual([yesterdayWord]));

    await userEvent.click(screen.getByRole("button", { name: /next puzzle/i }));

    expect(screen.getByText("Today's drop")).toBeInTheDocument();
    expect(screen.queryByText(/playing an old puzzle/i)).not.toBeInTheDocument();
    await waitFor(() => expect(loggedWords()).toEqual([todayWord]));
    expect(savedProgress(YESTERDAY)?.acceptedWords.map((w) => w.word)).toEqual([yesterdayWord]);
  });

  it("banks a word only the live lookup can vouch for", async () => {
    stubFetch({
      word: OFF_LIST_WORD,
      outcome: "playable",
      reason: null,
      zipf: 2.5,
      pos: ["noun"],
      firstUse: "1961",
    });
    render(<App />);

    await submit(OFF_LIST_WORD);

    await waitFor(() => expect(loggedWords()).toEqual([OFF_LIST_WORD]));
    // A live-confirmed word reads exactly like a curated one.
    expect(screen.getByRole("status")).toHaveTextContent(
      new RegExp(`"${OFF_LIST_WORD}" accepted`, "i")
    );
    expect(savedProgress(TODAY)?.acceptedWords.map((w) => w.word)).toEqual([OFF_LIST_WORD]);
  });

  it("reports a live lookup that comes back empty without logging the word", async () => {
    render(<App />);

    await submit(OFF_LIST_WORD);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/not in available dictionaries|spelling/i)
    );
    expect(loggedWords()).toEqual([]);
  });
});
