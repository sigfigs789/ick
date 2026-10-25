import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUGGESTION_CHECK_MS,
  checkSuggestions,
  claimSuggestionNotice,
  isFirstAcceptance,
  markThanked,
  mergePlayerSuggestions,
  recordSuggestion,
  suggestedWords,
  suggestionCheckDue,
  unthankedAcceptedWords,
} from "./suggestions";

const PLAYER = "3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const NOW = Date.parse("2026-10-25T12:00:00Z");

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("suggestions", () => {
  it("records a suggestion once, and says whether it was the first", () => {
    expect(recordSuggestion("zibeline", "2026-10-20")).toBe(true);
    expect(recordSuggestion("zibeline", "2026-10-21")).toBe(false);
    expect(recordSuggestion("quockerwodger", "2026-10-22")).toBe(false);
    expect(suggestedWords()).toEqual([
      { word: "zibeline", suggestedOn: "2026-10-20" },
      { word: "quockerwodger", suggestedOn: "2026-10-22" },
    ]);
  });

  it("brings in suggestions made before the list existed, and dates an acceptance to when it was seen", () => {
    recordSuggestion("zibeline", "2026-10-20");
    mergePlayerSuggestions(
      [
        { word: "zibeline", at: "2026-10-20T09:00:00Z", mark: null },
        { word: "quockerwodger", at: "2026-09-01T09:00:00Z", mark: "accepted" },
      ],
      "2026-10-25",
      NOW
    );
    expect(suggestedWords().map((w) => w.word)).toEqual(["quockerwodger", "zibeline"]);
    expect(unthankedAcceptedWords()).toEqual([
      { word: "quockerwodger", suggestedOn: "2026-09-01", acceptedOn: "2026-10-25", thanked: false },
    ]);
  });

  it("thanks a player once per accepted word", () => {
    mergePlayerSuggestions([{ word: "zibeline", at: "2026-10-01T09:00:00Z", mark: "accepted" }], "2026-10-25", NOW);
    expect(isFirstAcceptance(unthankedAcceptedWords())).toBe(true);
    markThanked(["zibeline"]);
    expect(unthankedAcceptedWords()).toEqual([]);

    // Seen accepted again: no second thank-you.
    mergePlayerSuggestions([{ word: "zibeline", at: "2026-10-01T09:00:00Z", mark: "accepted" }], "2026-10-26", NOW);
    expect(unthankedAcceptedWords()).toEqual([]);

    mergePlayerSuggestions(
      [
        { word: "zibeline", at: "2026-10-01T09:00:00Z", mark: "accepted" },
        { word: "quockerwodger", at: "2026-10-02T09:00:00Z", mark: "accepted" },
      ],
      "2026-10-27",
      NOW
    );
    expect(unthankedAcceptedWords().map((w) => w.word)).toEqual(["quockerwodger"]);
    expect(isFirstAcceptance(unthankedAcceptedWords())).toBe(false);
  });

  it("keeps an acceptance whose mark is later taken back", () => {
    mergePlayerSuggestions([{ word: "zibeline", at: "2026-10-01T09:00:00Z", mark: "accepted" }], "2026-10-25", NOW);
    mergePlayerSuggestions([{ word: "zibeline", at: "2026-10-01T09:00:00Z", mark: null }], "2026-10-26", NOW);
    expect(suggestedWords()[0].acceptedOn).toBe("2026-10-25");
  });

  it("asks once on a new browser, then only while a suggestion is waiting", () => {
    expect(suggestionCheckDue(NOW)).toBe(true);
    mergePlayerSuggestions([], "2026-10-25", NOW);
    expect(suggestionCheckDue(NOW + SUGGESTION_CHECK_MS)).toBe(false);

    recordSuggestion("zibeline", "2026-10-25");
    expect(suggestionCheckDue(NOW + 1000)).toBe(false);
    expect(suggestionCheckDue(NOW + SUGGESTION_CHECK_MS)).toBe(true);

    mergePlayerSuggestions([{ word: "zibeline", at: "2026-10-25T09:00:00Z", mark: "rejected" }], "2026-10-25", NOW);
    expect(suggestionCheckDue(NOW + SUGGESTION_CHECK_MS)).toBe(false);
  });

  it("asks the server for this player's suggestions and folds them in", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ suggestions: [{ word: "zibeline", at: "2026-10-01T09:00:00Z", mark: "accepted" }] }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    await checkSuggestions(PLAYER);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      `/api/review?list=my-suggestions&player=${PLAYER}`
    );
    expect(unthankedAcceptedWords().map((w) => w.word)).toEqual(["zibeline"]);
  });

  it("shrugs off a failed ask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));
    await expect(checkSuggestions(PLAYER)).resolves.toBeUndefined();
    expect(suggestionCheckDue()).toBe(true);
  });

  it("shows the thank-you only on a day nothing else has, and keeps that day", () => {
    expect(claimSuggestionNotice("2026-10-25", true)).toBe(false);
    expect(claimSuggestionNotice("2026-10-26", false)).toBe(true);
    // A card that comes along after it does not take the day back.
    expect(claimSuggestionNotice("2026-10-26", true)).toBe(true);
    expect(claimSuggestionNotice("2026-10-27", true)).toBe(false);
  });
});
