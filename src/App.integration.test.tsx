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
import { addDays, todayDateString } from "./game/date";
import { dropForDate } from "./game/drop";
import { evaluateSubmission } from "./game/submit";
import { puzzleNumber } from "./game/share";
import { resetLiveCheckSession } from "./game/liveValidate";
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
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
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
    expect(screen.getByText(/1 of 5 used/i)).toBeInTheDocument();
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
    expect(screen.getByText(/1 of 5 used/i)).toBeInTheDocument();
    // Still playable: a restored puzzle picks up mid-game, not finished.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("explains a rejected guess and leaves the log untouched", async () => {
    render(<App />);

    await submit("aeiou".includes(DROP.toLowerCase()) ? "qwrtp" : "aeiou");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/doesn't contain the drop/i)
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
      expect(screen.getByRole("status")).toHaveTextContent(/already submitted that word/i)
    );
    expect(loggedWords()).toEqual([word]);
  });

  it("finishes the puzzle at the guess limit and swaps the form for the results", async () => {
    const words = playableWords(5, DROP, TODAY);
    render(<App />);

    for (const word of words) {
      await submit(word);
      await waitFor(() => expect(loggedWords()).toContain(word));
    }

    await waitFor(() =>
      expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /i'm done guessing/i })).not.toBeInTheDocument();
    expect(loggedWords()).toEqual(words);
    expect(savedProgress(TODAY)?.completed).toBe(true);
  });

  it("finishes early when the player locks in", async () => {
    const [word] = playableWords(1, DROP, TODAY);
    render(<App />);

    await submit(word);
    await waitFor(() => expect(loggedWords()).toEqual([word]));
    await userEvent.click(screen.getByRole("button", { name: /i'm done guessing/i }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: /share result/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    const saved = savedProgress(TODAY);
    expect(saved?.completed).toBe(true);
    expect(saved?.completedAt).toBeTruthy();
  });

  it("keeps an archived puzzle's progress separate from today's", async () => {
    const yesterdayDrop = dropForDate(YESTERDAY);
    const [todayWord] = playableWords(1, DROP, TODAY);
    const [yesterdayWord] = playableWords(1, yesterdayDrop, YESTERDAY);
    render(<App />);

    await submit(todayWord);
    await waitFor(() => expect(loggedWords()).toEqual([todayWord]));

    await userEvent.click(screen.getByRole("button", { name: /previous puzzle/i }));

    expect(screen.getByText(new RegExp(`Puzzle #${puzzleNumber(YESTERDAY)}`))).toBeInTheDocument();
    expect(screen.getByText(/playing an old puzzle/i)).toBeInTheDocument();
    expect(loggedWords()).toEqual([]);

    await submit(yesterdayWord);
    await waitFor(() => expect(loggedWords()).toEqual([yesterdayWord]));

    await userEvent.click(screen.getByRole("button", { name: /next puzzle/i }));

    expect(screen.getByText(new RegExp(`Puzzle #${puzzleNumber(TODAY)}`))).toBeInTheDocument();
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
      expect(screen.getByRole("status")).toHaveTextContent(/not in WordInk's curated list|spelling/i)
    );
    expect(loggedWords()).toEqual([]);
  });
});
