/**
 * Where a player stands against everybody else on the month's board, and the
 * two moments the game tells them: the day they climb into the top 10%, 5% or
 * 1%, and the first days of a new month, when the last one's place is final.
 *
 * The percentile is read off the monthly board the leaderboard page already
 * fetches: a rank, and how many players that board holds. The board is the
 * whole of it up to BOARD_LIMIT, and past that the size is the asker's own rank
 * at the most -- a floor, so a band can be under-awarded but never handed out
 * when it was not earned.
 */

import {
  BOARD_LIMIT,
  fetchBoards,
  monthFloor,
  type BoardEntry,
} from "./leaderboard";
import { monthStart, previousMonthStart } from "./month";
import { perfectMonthName } from "./perfectMonth";
import { loadPlayerId } from "./player";
import { todayDateString } from "./date";
import { currentMode, type GameMode } from "./mode";

export type TopPercentBand = 1 | 5 | 10;

/** Tightest first, so the first band a rank fits is the one it wears. */
const BANDS: readonly TopPercentBand[] = [1, 5, 10];

/**
 * The band a rank falls in on a board of `size` players, or null.
 *
 * "Top 10%" means within the first tenth of the board, rounded down -- so the
 * band only exists once the board is big enough to have one: ten players for
 * the top 10%, twenty for 5%, a hundred for 1%. That is the guard that keeps
 * second of three from being told it is in the top 5%, which would be true
 * arithmetic and a hollow compliment.
 */
export function topPercentBand(
  rank: number | null,
  size: number
): TopPercentBand | null {
  if (rank === null || rank < 1 || rank > size) return null;
  for (const band of BANDS) {
    if (rank <= Math.floor((size * band) / 100)) return band;
  }
  return null;
}

/**
 * How many players a board is known to hold: the rows sent, or further down if
 * the player's own row came back from below the cut.
 */
export function boardSize(
  entries: readonly unknown[],
  self: { rank: number | null } | null
): number {
  return Math.max(entries.length, self?.rank ?? 0);
}

/** The share of the board a rank is ahead of, in whole percent, rounded down. */
export function percentAhead(rank: number, size: number): number {
  if (size <= 0 || rank < 1) return 0;
  return Math.floor(((size - rank) / size) * 100);
}

/** What each band says: a short chip for the row, and a line to go with it. */
export const TOP_PERCENT_COPY: Record<
  TopPercentBand,
  { emoji: string; quip: string }
> = {
  1: { emoji: "💎", quip: "Top 1%. Rarer than most of the words you play." },
  5: { emoji: "🔥", quip: "Top 5%. You're on fire." },
  10: { emoji: "✨", quip: "Top 10%. Better than nine players in ten." },
};

/** Something to tell the player about their place on a month's board. */
export interface StandingNotice {
  /** `entered`: they just reached this band. `month`: the month closed here. */
  kind: "entered" | "month";
  band: TopPercentBand;
  rank: number;
  size: number;
  /** The first of the month the board counts. */
  month: string;
  mode: GameMode;
}

/**
 * How long into a new month the last one's result is still news. A player who
 * first opens the game on the 20th has moved on, and a report about a month
 * three weeks gone would read as a glitch rather than a cheer.
 */
export const MONTH_REPORT_DAYS = 7;

/**
 * What this browser has already been told, per board and month: the tightest
 * band announced, and whether the month's final result has been reported.
 */
export const STANDING_KEY = "ick:top-percent";

interface Told {
  band?: TopPercentBand;
  reported?: true;
}

function loadTold(): Record<string, Told> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STANDING_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Told>) : {};
  } catch {
    return {};
  }
}

function saveTold(key: string, told: Told): void {
  try {
    localStorage.setItem(STANDING_KEY, JSON.stringify({ ...loadTold(), [key]: told }));
  } catch {
    // Storage off: the worst case is being told twice, never failing to play.
  }
}

function toldKey(mode: GameMode, month: string): string {
  return `${mode}:${month}`;
}

/** The player's own row on a board, wherever it came back. */
function ownRow(
  entries: readonly BoardEntry[],
  self: BoardEntry | null,
  playerId: string
): BoardEntry | null {
  return entries.find((entry) => entry.playerId === playerId) ?? self;
}

/**
 * Whether there is anything to tell this player about their place, and what.
 *
 * Looks first at the month just gone, in its opening days, once; and otherwise
 * at this month, where a band is news only when it is tighter than the best one
 * already announced this month -- so slipping out of the top 5% and back in
 * again is not a second party. One board request either way, and none at all
 * for a browser that has no player id.
 */
export async function checkStanding(
  today: string = todayDateString(),
  options: { fresh?: boolean } = {}
): Promise<StandingNotice | null> {
  const playerId = loadPlayerId();
  if (!playerId) return null;

  // The board the player is on now: the one their scores are landing on.
  const mode = currentMode();
  const thisMonth = monthStart(today);
  const lastMonth = previousMonthStart(thisMonth);
  const lastKey = toldKey(mode, lastMonth);
  const lastTold = loadTold()[lastKey];

  if (
    Number(today.slice(8, 10)) <= MONTH_REPORT_DAYS &&
    lastMonth >= monthFloor() &&
    !lastTold?.reported
  ) {
    const boards = await fetchBoards(today, { month: lastMonth, mode, limit: BOARD_LIMIT });
    // Marked whether or not there is anything to say, so a month with no band
    // is one request and not one per open for a week.
    saveTold(lastKey, { ...lastTold, reported: true });
    const row = ownRow(boards.monthly, boards.monthlySelf, playerId);
    const size = boardSize(boards.monthly, boards.monthlySelf);
    const band = row ? topPercentBand(row.rank, size) : null;
    if (row && band) {
      return { kind: "month", band, rank: row.rank, size, month: lastMonth, mode };
    }
    return null;
  }

  const boards = await fetchBoards(today, { mode, limit: BOARD_LIMIT, fresh: options.fresh });
  const key = toldKey(mode, thisMonth);
  const row = ownRow(boards.monthly, boards.monthlySelf, playerId);
  const size = boardSize(boards.monthly, boards.monthlySelf);
  const band = row ? topPercentBand(row.rank, size) : null;
  if (!row || !band) return null;
  const best = loadTold()[key]?.band;
  if (best !== undefined && best <= band) return null;
  saveTold(key, { ...loadTold()[key], band });
  return { kind: "entered", band, rank: row.rank, size, month: thisMonth, mode };
}

/** `1st`, `2nd`, `23rd`, `112th`. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The card's two lines for a notice. */
export function standingCopy(notice: StandingNotice): { title: string; body: string } {
  const place = `${ordinal(notice.rank)} of ${notice.size} players`;
  const ahead =
    notice.rank === 1
      ? "ahead of everybody"
      : `ahead of ${percentAhead(notice.rank, notice.size)}% of them`;
  if (notice.kind === "month") {
    return {
      title: `${perfectMonthName(notice.month)}: top ${notice.band}%!`,
      body: `You finished ${place}, ${ahead}.`,
    };
  }
  return {
    title: `Top ${notice.band}% this month!`,
    body: `You're ${place} so far, ${ahead}.`,
  };
}
