// The rules a chat message has to pass, shared by the bubble and api/chat.ts.
//
// Both sides run the same check: the bubble so a player is told before they
// send, the endpoint because anything the browser checks can be skipped. The
// endpoint's answer is the one that counts.
//
// Profanity is `obscenity`'s English set, which catches the disguised spellings
// a plain word list misses (sh1t, shiiit, fuuuck) while leaving Scunthorpe and
// assassin alone. It does not catch letters split by punctuation (f.u.c.k).
//
// EXTRA_SLURS tops it up with the slurs in scripts/blocklist.txt that obscenity
// misses. Not the whole blocklist: most of that file is abbreviations (aka, ave)
// and words with ordinary uses (cripple, molest) that the puzzle refuses for its
// own reasons and a conversation has every right to contain.
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

/** The longest message the room takes. The table's check constraint agrees. */
export const CHAT_MAX_LENGTH = 280;

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const EXTRA_SLURS: ReadonlySet<string> = new Set([
  "coon", "coons", "gook", "gooks", "jap", "japs", "squaw", "squaws",
  "wetback", "wetbacks", "wop", "wops",
]);

/** Why a message cannot be sent, or null when it can. */
export type ChatProblem = "empty" | "too-long" | "profane";

/**
 * Collapse whitespace and trim, so what is checked is what is stored. Line
 * breaks go too: the room is one line per message.
 */
export function normaliseMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Check a message that has already been through `normaliseMessage`. */
export function chatProblem(body: string): ChatProblem | null {
  if (body.length === 0) return "empty";
  if (body.length > CHAT_MAX_LENGTH) return "too-long";
  if (matcher.hasMatch(body)) return "profane";
  const words = body.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((word) => EXTRA_SLURS.has(word))) return "profane";
  return null;
}
