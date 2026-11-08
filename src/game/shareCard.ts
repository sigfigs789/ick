/**
 * The result a share link carries, so the link's preview can be a picture of
 * the share block instead of the generic WordInk card.
 *
 * A chat app that unfurls a link fetches the page and reads its og:image. The
 * page is the same for every share, so to show *this* result the link has to
 * name it: api/share-page.ts reads these parameters and points og:image at
 * api/share-image.ts, which draws them.
 *
 * Only what the shared text already says rides on the link -- a spoiler-free
 * share carries squares and scores and no words -- so the picture never gives
 * away more than the message it sits under.
 *
 * The link is `/r?...` rather than `/?...`: Vercel serves a static file before
 * any rewrite, so the root always answers with the built page, and only a path
 * with no file behind it can be routed to api/share-page.ts. The game treats
 * any path it does not know as itself, so `/r` plays exactly like `/`.
 *
 * Short keys, one per field, because the link sits at the bottom of a result
 * pasted into group chats:
 *   d  puzzle date, YYYYMMDD
 *   p  the drop
 *   m  mode letter, only where the share names the mode
 *   w  one entry per word, `_`-joined: rarity letter, score, then the word if named
 *   t  the total, labelled "Total"; `y` instead when labelled "Today"
 *   k  streak in days
 *   n  "Playing as" name
 */
import type { Rarity } from "./types";

/** A rarity as the share draws it. `legacy-legend` is the orange Legend wore before the retune. */
export type CardRarity = Rarity | "legacy-legend";

export type CardMode = "Standard" | "Freeform";

export interface CardWord {
  rarity: CardRarity;
  /** The score exactly as the share text prints it, e.g. "7.2" or "9.91". */
  score: string;
  word?: string;
}

export interface ShareCard {
  /** YYYY-MM-DD */
  date: string;
  drop: string;
  /** The mode label, when the share names one. */
  mode?: CardMode;
  words: CardWord[];
  total: string;
  totalLabel: "Today" | "Total";
  streak?: number;
  playerName?: string;
}

const RARITY_CODE: Record<CardRarity, string> = {
  Quotidian: "q",
  Common: "c",
  Uncommon: "u",
  Rare: "r",
  "Extremely Rare": "e",
  Elusive: "y",
  Mythic: "m",
  Legend: "l",
  "legacy-legend": "o",
};
const CODE_RARITY = Object.fromEntries(
  Object.entries(RARITY_CODE).map(([rarity, code]) => [code, rarity as CardRarity]),
) as Record<string, CardRarity>;

const MODE_CODE = { Standard: "s", Freeform: "f" } as const;
const CODE_MODE: Record<string, CardMode | undefined> = { s: "Standard", f: "Freeform" };

/** Caps that keep a hand-made link from drawing a wall of text. */
export const CARD_MAX_WORDS = 12;
export const CARD_MAX_WORD_LENGTH = 30;
export const CARD_MAX_NAME_LENGTH = 40;

const TOTAL = /^\d{1,4}\.\d{1,2}$/;
const WORD_ENTRY = /^([a-z])(\d{1,2}\.\d{1,2})([a-z]*)$/;

/** The path a result link points at. */
export const SHARE_CARD_PATH = "/r";

/** The card as query parameters, in link order. */
export function encodeShareCard(card: ShareCard): [string, string][] {
  const params: [string, string][] = [
    ["d", card.date.replace(/-/g, "")],
    ["p", card.drop.toLowerCase()],
  ];
  if (card.mode) params.push(["m", MODE_CODE[card.mode]]);
  if (card.words.length > 0) {
    params.push([
      "w",
      card.words
        .map((w) => `${RARITY_CODE[w.rarity]}${w.score}${w.word?.toLowerCase() ?? ""}`)
        .join("_"),
    ]);
  }
  params.push([card.totalLabel === "Today" ? "y" : "t", card.total]);
  if (card.streak !== undefined) params.push(["k", String(card.streak)]);
  if (card.playerName) params.push(["n", card.playerName]);
  return params;
}

/** The card a link carries, or null when it carries none (or a broken one). */
export function decodeShareCard(params: URLSearchParams): ShareCard | null {
  const rawDate = params.get("d") ?? "";
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(rawDate);
  if (!dateMatch) return null;
  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

  const drop = (params.get("p") ?? "").toLowerCase();
  if (!/^[a-z]{1,8}$/.test(drop)) return null;

  const todayTotal = params.get("y");
  const total = todayTotal ?? params.get("t") ?? "";
  if (!TOTAL.test(total)) return null;

  const words: CardWord[] = [];
  const rawWords = params.get("w");
  if (rawWords) {
    for (const entry of rawWords.split("_").slice(0, CARD_MAX_WORDS)) {
      const match = WORD_ENTRY.exec(entry);
      const rarity = match && CODE_RARITY[match[1]];
      if (!match || !rarity) return null;
      const word = match[3].slice(0, CARD_MAX_WORD_LENGTH);
      words.push(word ? { rarity, score: match[2], word } : { rarity, score: match[2] });
    }
  }

  const card: ShareCard = {
    date,
    drop,
    words,
    total,
    totalLabel: todayTotal !== null ? "Today" : "Total",
  };
  const mode = CODE_MODE[params.get("m") ?? ""];
  if (mode) card.mode = mode;
  const streak = params.get("k");
  if (streak && /^\d{1,5}$/.test(streak)) card.streak = Number(streak);
  const name = params.get("n")?.trim().slice(0, CARD_MAX_NAME_LENGTH);
  if (name) card.playerName = name;
  return card;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 8" -- the share heading's date, without a locale to read it in. */
export function cardDateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${d}`;
}

/** The share heading, as buildShareText writes it. */
export function cardHeading(card: ShareCard): string {
  const mode = card.mode ? ` · ${card.mode}` : "";
  return `${cardDateLabel(card.date)} — Drop: ${card.drop.toUpperCase()}${mode}`;
}
