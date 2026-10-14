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

/**
 * A word scoring this much or more is announced in the room even when it is not
 * the puzzle's record: Mythic and above, as the score is displayed.
 */
export const NOTICE_MIN_SCORE = 9.5;

/**
 * The least a word can score and still be announced as a puzzle's top score: an
 * early 3.2 is the best so far, but not news.
 */
export const TOP_NOTICE_MIN_SCORE = 7;

/** What a room notice says about one banked word. See the 20261013 migration. */
export interface BankedWord {
  /** The puzzle it was banked on, YYYY-MM-DD. */
  date: string;
  word: string;
  /** The tier the game showed, e.g. "Mythic". */
  tier: string;
  /** The score as the game displayed it, e.g. "9.62". */
  score: string;
  mode: "standard" | "freeform";
}

/**
 * What a notice says the player did with the word. Rotated so a room with a few
 * notices in it does not read as one line pasted over and over.
 */
export const NOTICE_VERBS: readonly string[] = [
  "banked", "found", "unearthed", "dug up", "struck", "landed", "spotted", "nabbed",
];

/**
 * The verb for one player's word: picked from the handle and the word rather
 * than at random, so the same notice always reads the same way.
 */
export function noticeVerb(handle: string, word: string): string {
  return NOTICE_VERBS[noticeHash(handle, word) % NOTICE_VERBS.length];
}

function noticeHash(handle: string, word: string): number {
  let hash = 0;
  for (const ch of `${handle}:${word}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * What a notice says the player did to the top score when they took it from
 * another player. Rotated and picked the way NOTICE_VERBS are.
 */
export const USURP_VERBS: readonly string[] = [
  "usurped", "seized", "snatched", "stole", "claimed", "took",
];

/** The usurping verb for one player's word; see noticeVerb. */
export function usurpVerb(handle: string, word: string): string {
  return USURP_VERBS[noticeHash(handle, word) % USURP_VERBS.length];
}

/** Whether a word scores enough to be announced as a puzzle's top score. */
export function earnsTopNotice(score: string): boolean {
  return Number(score) >= TOP_NOTICE_MIN_SCORE;
}

/**
 * The line posted when `word` beats every other player's word on its puzzle so
 * far, or null for a word under 7.0.
 */
export function topNoticeBody(handle: string, banked: BankedWord): string | null {
  if (!earnsTopNotice(banked.score)) return null;
  const where = banked.mode === "freeform" ? " in Freeform" : "";
  const verb = noticeVerb(handle, banked.word);
  return `${handle} ${verb} top scoring word ${banked.word} (${banked.tier}, ${banked.score})${where}`;
}

/**
 * The line posted when `word` takes the top score from another player -- by
 * beating it or by matching it -- or null for a word under 7.0.
 */
export function usurpNoticeBody(handle: string, banked: BankedWord): string | null {
  if (!earnsTopNotice(banked.score)) return null;
  const where = banked.mode === "freeform" ? " in Freeform" : "";
  const verb = usurpVerb(handle, banked.word);
  return `${handle} ${verb} the top score with ${banked.word} (${banked.tier}, ${banked.score})${where}`;
}

/** The line posted for a 9.5+ word, or null for one that scores less. */
export function tierNoticeBody(handle: string, banked: BankedWord): string | null {
  if (!(Number(banked.score) >= NOTICE_MIN_SCORE)) return null;
  const where = banked.mode === "freeform" ? " in Freeform" : "";
  const verb = noticeVerb(handle, banked.word);
  return `${handle} ${verb} ${banked.tier} word ${banked.word} (${banked.score})${where}`;
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
