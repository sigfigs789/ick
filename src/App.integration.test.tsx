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
import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("./eventLog", () => ({ logEvent: track }));

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
 * A puzzle from on or after the reveal's start, for the one test that has to
 * stand on the far side of that gate (see game/constants.revealGatedFor).
 */
const GATED_DAY = "2026-09-12";

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
  // Reporting is on here, so finishing a puzzle would draw the word of the day
  // experiment at random; these tests are about the word itself.
  localStorage.setItem("ick:word-of-day", "shown");
  // And banking a word would draw the come-back test; keep its line on.
  localStorage.setItem("ick:come-back-test", "shown");
  // And opening a puzzle would draw the input placement test; keep the input
  // where these tests expect it, under the drop.
  localStorage.setItem("ick:input-placement-test", "above");
  resetLiveCheckSession();
  track.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Only the reveal test pins the clock (it has to stand on the far side of a
  // date gate); every other test here plays on the real one.
  vi.useRealTimers();
});

describe("input placement test", () => {
  /** Whether the guess input comes after the guess log on the page. */
  function inputBelowLog(): boolean {
    const log = screen.getByRole("region", { name: /your guesses/i });
    const input = screen.getByLabelText(/enter a word containing/i);
    return Boolean(log.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  it("keeps the input above the guess log for the above arm", () => {
    render(<App />);
    expect(inputBelowLog()).toBe(false);
  });

  it("puts the input below the guess log for the below arm, and plays from there", async () => {
    localStorage.setItem("ick:input-placement-test", "below");
    const [word] = playableWords(1, DROP, TODAY);
    render(<App />);
    expect(inputBelowLog()).toBe(true);

    await submit(word);
    await waitFor(() => expect(loggedWords()).toEqual([word]));
    expect(inputBelowLog()).toBe(true);
  });

  it("draws a player once, the first time the input shows, and reports it", () => {
    localStorage.removeItem("ick:input-placement-test");
    const first = render(<App />);
    const arm = localStorage.getItem("ick:input-placement-test");
    expect(arm === "above" || arm === "below").toBe(true);
    expect(inputBelowLog()).toBe(arm === "below");
    const draws = () => track.mock.calls.filter(([name]) => name === "input_placement_assigned");
    expect(draws()).toHaveLength(1);
    expect(draws()[0][1]).toMatchObject({
      variant: arm === "below" ? "shown" : "hidden",
      placement: arm,
      returning: false,
      puzzle_date: TODAY,
    });

    first.unmount();
    render(<App />);
    expect(draws()).toHaveLength(1);
  });
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

  it("keeps the day's answer hidden until every guess is spent", async () => {
    // Pinned into the gated era rather than played on the real clock: the
    // reveal is date-gated (game/constants.revealGatedFor), so a suite that
    // used today would tell one story before the start and another after it.
    // `shouldAdvanceTime` keeps userEvent's own waits moving.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(`${GATED_DAY}T12:00:00`));
    const drop = dropForDate(GATED_DAY);
    const words = playableWords(maxGuessesFor(GATED_DAY), drop, GATED_DAY);
    render(<App />);

    const revealed = () => document.querySelector(".drop-display__ceiling-word");
    expect(revealed()).not.toBeInTheDocument();

    for (const [i, word] of words.entries()) {
      await submit(word);
      await waitFor(() => expect(loggedWords()).toContain(word));
      // Still hidden on every guess but the last, which is the whole point:
      // there is no longer a button that trades the rest of the puzzle for it.
      if (i < words.length - 1) expect(revealed()).not.toBeInTheDocument();
    }

    // Finishing is not enough while the retry is unspent: the word can still
    // re-open the puzzle, so it costs the retry to look at.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Word of the day" })).toBeInTheDocument(),
    );
    expect(revealed()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Word of the day" }));
    await userEvent.click(
      screen.getByRole("dialog").querySelector<HTMLButtonElement>(".reveal-modal__confirm")!,
    );

    await waitFor(() => expect(revealed()).toBeInTheDocument());
    // Paid for out of the retry, and the guess log says so.
    expect(screen.getByText(/retry used/i)).toBeInTheDocument();
    expect(savedProgress(GATED_DAY)?.retryUsed).toBe(true);
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
