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
 * A word scoring this much or more is announced in the room: Mythic and above,
 * as the score is displayed. Nothing under it is, the puzzle's record included.
 */
export const NOTICE_MIN_SCORE = 9.5;

/** The tiers a notice can be for; the room is colored by which. */
export const NOTICE_TIERS: readonly string[] = ["Mythic", "Legend"];

/** Stands in for the first finder's handle in an "earlier" line; the database fills it in. */
export const FINDER_PLACEHOLDER = "{finder}";

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
  let hash = 0;
  for (const ch of `${handle}:${word}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return NOTICE_VERBS[hash % NOTICE_VERBS.length];
}

/** How every notice ends: which game the word was found in. */
export function modeSuffix(mode: BankedWord["mode"]): string {
  return ` in ${mode} mode`;
}

/** Whether a banked word earns a notice at all: Mythic or Legend, 9.5 or more. */
export function earnsNotice(banked: Pick<BankedWord, "tier" | "score">): boolean {
  return NOTICE_TIERS.includes(banked.tier) && Number(banked.score) >= NOTICE_MIN_SCORE;
}

/**
 * The line the room posts when somebody is the first to bank a 9.5+ word on a
 * puzzle, or null for a word that earns none.
 */
export function findNoticeBody(handle: string, banked: BankedWord): string | null {
  if (!earnsNotice(banked)) return null;
  const verb = noticeVerb(handle, banked.word);
  return `${handle} ${verb} ${banked.tier} word ${banked.word} (${banked.score})${modeSuffix(banked.mode)}`;
}

/**
 * The ways of telling a player somebody got to their word first. `{finder}` is
 * the first finder's handle, filled in by the database, which alone knows it.
 */
export const EARLIER_LINES: readonly ((word: string) => string)[] = [
  (word) => `${FINDER_PLACEHOLDER} discovered ${word} earlier`,
  (word) => `${FINDER_PLACEHOLDER} unearthed ${word} first`,
  (word) => `${FINDER_PLACEHOLDER} beat you to ${word}`,
  (word) => `${FINDER_PLACEHOLDER} spotted ${word} before you did`,
  (word) => `Great minds: ${FINDER_PLACEHOLDER} found ${word} earlier`,
  (word) => `So close! ${FINDER_PLACEHOLDER} dug up ${word} a little earlier`,
];

/**
 * The line only the player who banked `word` sees when somebody else already
 * announced it, with `{finder}` for the one who did; null for a word that
 * earns no notice.
 */
export function earlierNoticeBody(handle: string, banked: BankedWord): string | null {
  if (!earnsNotice(banked)) return null;
  let hash = 0;
  for (const ch of `${banked.word}:${handle}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${EARLIER_LINES[hash % EARLIER_LINES.length](banked.word)}${modeSuffix(banked.mode)}`;
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
