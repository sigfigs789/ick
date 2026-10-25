/**
 * The words this player has suggested, and which of them got in.
 *
 * A suggestion used to leave nothing behind on the device: the box sent a
 * `word_suggested` event and said thanks, and whether the word was ever added
 * was something the player could only find by scrolling /suggested-words. Now
 * the browser keeps its own list, so it can thank the player when a word of
 * theirs is accepted (see components/SuggestionAcceptedNotice.tsx) and award
 * the two achievements that go with suggesting (see game/achievements.ts).
 *
 * The list is filled from two places. A word typed into the box is recorded the
 * moment it is sent. And the server is asked, now and then, for every word this
 * board identity has ever suggested and the mark each one wears on the queue
 * (`fetchPlayerSuggestions`) -- which brings in the words suggested before this
 * list existed, or on another browser the identity was moved from, and is the
 * only place an acceptance can be learned from at all.
 *
 * "Accepted" is the queue's own mark: `word_sightings.status`, the box ticked
 * on /suggested-words. The day the browser first saw that mark is the day the
 * word counts as accepted here; the server keeps no date for it.
 */

import { todayDateString, toDateString } from "./date";
import { fetchPlayerSuggestions, type PlayerSuggestion } from "./review";

export const SUGGESTIONS_KEY = "ick:suggestions";

/** How long between asks while a suggestion is still waiting on a verdict. */
export const SUGGESTION_CHECK_MS = 6 * 60 * 60 * 1000;

export interface SuggestedWordRecord {
  word: string;
  /** The day it was first suggested. */
  suggestedOn: string;
  /** The day this browser first saw it accepted; absent until then. */
  acceptedOn?: string;
  /** The queue marked it rejected. */
  rejected?: boolean;
  /** Whether the player has been thanked for it getting in. */
  thanked?: boolean;
}

interface Stored {
  words: SuggestedWordRecord[];
  /** When the server was last asked, in epoch ms. */
  checkedAt?: number;
}

function read(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return { words: [] };
    const { words, checkedAt } = parsed as Partial<Stored>;
    return {
      words: Array.isArray(words)
        ? words.filter(
            (w): w is SuggestedWordRecord =>
              !!w && typeof w.word === "string" && typeof w.suggestedOn === "string"
          )
        : [],
      checkedAt: typeof checkedAt === "number" ? checkedAt : undefined,
    };
  } catch {
    return { words: [] };
  }
}

function write(stored: Stored): void {
  try {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(stored));
  } catch {
    // Unwritable storage only means the server is asked again next time.
  }
}

/** Every word this player has suggested, earliest first. */
export function suggestedWords(): SuggestedWordRecord[] {
  return [...read().words].sort((a, b) => a.suggestedOn.localeCompare(b.suggestedOn));
}

/**
 * Keep a word the player just suggested. Returns whether it was their first
 * suggestion ever, which is the moment the suggesting achievement is earned.
 */
export function recordSuggestion(word: string, today: string = todayDateString()): boolean {
  const stored = read();
  const first = stored.words.length === 0;
  if (!stored.words.some((w) => w.word === word)) {
    stored.words.push({ word, suggestedOn: today });
    write(stored);
  }
  return first;
}

/**
 * Fold the server's answer into the list: words not seen here before are added,
 * and a word newly marked accepted is dated today and left waiting for its
 * thank-you. A word whose mark is later taken back keeps its acceptance -- the
 * badge it earned stays earned, as every other one does.
 */
export function mergePlayerSuggestions(
  rows: readonly PlayerSuggestion[],
  today: string = todayDateString(),
  now: number = Date.now()
): void {
  const stored = read();
  const byWord = new Map(stored.words.map((w) => [w.word, w]));
  for (const row of rows) {
    let record = byWord.get(row.word);
    if (!record) {
      const at = new Date(row.at);
      record = {
        word: row.word,
        suggestedOn: Number.isNaN(at.getTime()) ? today : toDateString(at),
      };
      byWord.set(row.word, record);
      stored.words.push(record);
    }
    if (row.mark === "accepted" && !record.acceptedOn) {
      record.acceptedOn = today;
      record.thanked = false;
    }
    record.rejected = row.mark === "rejected" ? true : undefined;
  }
  stored.checkedAt = now;
  write(stored);
}

/** Accepted words the player has not been thanked for yet, earliest first. */
export function unthankedAcceptedWords(): SuggestedWordRecord[] {
  return suggestedWords().filter((w) => w.acceptedOn && !w.thanked);
}

/** Whether `words` are the only accepted suggestions this player has. */
export function isFirstAcceptance(words: readonly SuggestedWordRecord[]): boolean {
  const accepted = suggestedWords().filter((w) => w.acceptedOn);
  return accepted.length > 0 && accepted.every((w) => words.some((n) => n.word === w.word));
}

/** The player has seen the thank-you for `words`. */
export function markThanked(words: readonly string[]): void {
  const stored = read();
  for (const record of stored.words) {
    if (words.includes(record.word)) record.thanked = true;
  }
  write(stored);
}

/**
 * Whether it is time to ask the server again: once on a browser that has never
 * asked (to find the suggestions made before this list existed), and after that
 * only while some suggestion is still waiting for a verdict, and not more often
 * than `SUGGESTION_CHECK_MS`.
 */
export function suggestionCheckDue(now: number = Date.now()): boolean {
  const { words, checkedAt } = read();
  if (checkedAt === undefined) return true;
  if (!words.some((w) => !w.acceptedOn && !w.rejected)) return false;
  return now - checkedAt >= SUGGESTION_CHECK_MS;
}

/**
 * Ask the server about `player`'s suggestions when one is due, and fold in the
 * answer. Never throws: a failed ask is tried again on a later visit.
 */
export async function checkSuggestions(player: string): Promise<void> {
  if (!suggestionCheckDue()) return;
  try {
    mergePlayerSuggestions(await fetchPlayerSuggestions(player));
  } catch {
    // Nothing waits on this; the next visit asks again.
  }
}
