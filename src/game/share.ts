import { daysSinceEpoch, formatDateLabel } from "./date";
import {
  formatRarityScore,
  totalRarityScore,
  usesRetunedTiers,
} from "./dictionary";
import { MODE_LABELS, currentMode, modeForDate, modeIsChosen, type GameMode } from "./mode";
import { shareCode } from "./onboarding";
import dropData from "../data/drops.json";
import type { AcceptedWord, Rarity } from "./types";

// Mirrors the in-app "loot tier" rarity palette (grey -> green ->
// blue -> purple -> gold -> red -> black, see index.css) so the shared result
// matches what showed up in-game. Legend, the top rank, is black -- the one
// square that reads as absence rather than a hue, which is what makes it land.
// Quotidian is reachable only on puzzles predating the retuned tiers; its egg
// is an intentional Easter egg.
// Squares only vary by color, which is fine here because this text is for
// sharing outside the app -- inside the app, rarity is always shown as a
// plain-text label too (see RarityBadge), which is what keeps things
// color-independent for accessibility.
export const RARITY_SYMBOL: Record<Rarity, string> = {
  Quotidian: "🥚",
  Common: "⬜",
  Uncommon: "🟩",
  Rare: "🟦",
  "Extremely Rare": "🟪",
  Elusive: "🟨",
  Mythic: "🟥",
  Legend: "⬛",
};

// Before the tiers were retuned, Legend wore orange.
// An archived result has to share the square it was played with, so the top
// rank is looked up through the puzzle's own date.
const PRE_RETUNE_SYMBOL: Partial<Record<Rarity, string>> = { Legend: "🟧" };

/** The share square for `rarity` on `date`'s puzzle. */
export function raritySymbol(rarity: Rarity, date?: string): string {
  if (!usesRetunedTiers(date)) return PRE_RETUNE_SYMBOL[rarity] ?? RARITY_SYMBOL[rarity];
  return RARITY_SYMBOL[rarity];
}

export type ShareSource = "share" | "twitter";

/**
 * The link under a shared result. A tagged link carries the mode it was shared
 * from, so a friend who has never played starts in the same game as the result
 * they were sent (see game/onboarding.ts) -- `?s=sh.f`, `?s=t.s`.
 *
 * Both tagged links name the www host. The bare domain answers with a redirect
 * to it, which is a round trip a friend's first load spends before the game
 * has started downloading.
 */
function shareUrl(source: ShareSource | null, mode: GameMode): string {
  if (source === "share") return `https://www.wordink.app/?s=${shareCode("sh", mode)}`;
  if (source === "twitter") return `www.wordink.app/?s=${shareCode("t", mode)}`;
  return "wordink.app";
}

export function puzzleNumber(dateStr: string): number {
  return daysSinceEpoch(dateStr, dropData.epoch) + 1;
}

/** The rarest accepted word: lowest Zipf, i.e. the highest rarity score. */
function rarestWord(words: AcceptedWord[]): AcceptedWord | undefined {
  return words.reduce<AcceptedWord | undefined>(
    (best, w) => (best === undefined || w.zipf < best.zipf ? w : best),
    undefined,
  );
}

/**
 * How much of the player's answers the shared result names:
 * - `"none"`: squares and scores only, no words (the spoiler-free default).
 * - `"top"`: name only the rarest word; the rest stay anonymous squares.
 * - `"all"`: name every word.
 */
export type RevealMode = "none" | "top" | "all";

export interface ShareOptions {
  /** How much to reveal in the result lines. Defaults to "none". */
  reveal?: RevealMode;
  /**
   * @deprecated Use `reveal`. When `reveal` is unset, `true`/undefined maps to
   * "none" and `false` maps to "all", preserving the original two-state API.
   */
  spoilerFree?: boolean;
  /** Current consecutive-day streak to include in the shared result. */
  streak?: number;
  /**
   * The name the sharer plays under (see `selfName` in game/player.ts), quoted
   * as "Playing as …" so a reader can find them on the board. Left off when the
   * player has chosen not to share it, or has no name to share.
   */
  playerName?: string | null;
  /**
   * Whether this is the current puzzle, which is what lets its score be called
   * "Today". Defaults to false: the neutral "Total" is never wrong, so a caller
   * that does not know says nothing.
   */
  isToday?: boolean;
  /** Adds attribution to a link at the moment it is shared. */
  source?: ShareSource | null;
  /** Uses the shorter X post layout while keeping the selected spoiler setting. */
  format?: "default" | "x";
  /**
   * Which rules the puzzle was played under, when the reader needs telling.
   *
   * Named on the share from MODE_CHOICE_START on, because from there two people
   * posting the same drop are no longer posting the same game: an unfolded 9.9
   * and a folded 6.1 are both honest results and a reader comparing them without
   * being told which is which is being misled by the format. Left off for every
   * puzzle before it, where the date already decided the rules for everybody and
   * a mode line would be a label on a choice nobody made.
   *
   * Defaults to the mode the record carries, which is the mode it was played in.
   */
  mode?: GameMode;
}

/**
 * Builds the shareable result text. `reveal` controls how much is named:
 * "none" (the default) shows one line per rarity square and score with no
 * words; "top" additionally names the rarest word; "all" names every word,
 * each with its own rarity square and numeric rarity score.
 */
export function buildShareText(
  dateStr: string,
  drop: string,
  words: AcceptedWord[],
  options: ShareOptions = {},
): string {
  const reveal: RevealMode =
    options.reveal ?? (options.spoilerFree === false ? "all" : "none");
  const source = options.source ?? null;
  const format = options.format ?? "default";
  const label = formatDateLabel(dateStr);

  // The rarest word is the one "top" reveals.
  const best = rarestWord(words);
  const resultLine = words
    .map((w) => {
      const named = reveal === "all" || (reveal === "top" && w === best);
      const score = formatRarityScore(w.zipf, dateStr);
      return named
        ? `${raritySymbol(w.rarity, dateStr)} ${w.word} (${score})`
        : `${raritySymbol(w.rarity, dateStr)} ${score}`;
    })
    .join("\n");

  // The mode rides on the heading rather than taking a line of its own: it is a
  // fact about the puzzle, like the date and the drop beside it, and a share
  // this short cannot spare a row to say one word. The heading also survives the
  // X layout, which drops the stats block entirely -- so this is the one place
  // that names the mode on every share there is.
  const mode = options.mode ?? modeForDate(dateStr);
  const modeLabel = modeIsChosen(dateStr) ? ` · ${MODE_LABELS[mode]}` : "";
  const lines = [`${label} — Drop: ${drop.toUpperCase()}${modeLabel}`];
  if (resultLine) lines.push("", resultLine);
  const playerName = options.playerName || null;
  const progressLine =
    format === "default" && (options.streak !== undefined || playerName !== null);
  // "Today" only where it is true -- an archive result is headed with its own
  // date, and "Today" under that date would contradict it.
  const scoreLabel = options.isToday ? "Today" : "Total";
  const score = totalRarityScore(words, dateStr).toFixed(1);
  // The blank line separates the squares from the stats block, so it belongs
  // wherever that block starts -- and there is no block to separate when the
  // score is the only line of it.
  if (resultLine && progressLine) lines.push("");
  // The score shares the streak's line rather than taking one of its own. The
  // streak leads because it is the one figure here that is not a score: a count
  // of days, and the score beside it is the detail of it. With no streak (the X
  // layout, or a caller that has none) the score stands alone.
  const scoreText = `${scoreLabel}: ${score}`;
  if (progressLine && options.streak !== undefined) {
    const streak = options.streak;
    lines.push(`Streak: ${streak} day${streak === 1 ? "" : "s"} · ${scoreText}`);
  } else {
    lines.push(scoreText);
  }
  // Who played it, so a reader can find the sharer on the board. The X layout
  // drops it with the rest of the stats block.
  if (progressLine && playerName) lines.push(`Playing as ${playerName}`);
  // The link opens today's puzzle, not this one, so an archived day from before
  // the switch -- whose mode the calendar picked -- sends the sharer's own.
  lines.push(shareUrl(source, modeIsChosen(dateStr) ? mode : currentMode()));
  return lines.join("\n");
}
