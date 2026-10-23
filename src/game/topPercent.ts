/**
 * The "you're in the top 10%" nod a player gets on their own leaderboard row.
 *
 * Three bands, tightest first, and a player wears only the best one they reach.
 * Rank 1 is not one of them: the leader already has the trophy, which says more
 * than any percentage could.
 */

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
 *
 * `size` should be a lower bound on the board, never a guess above it: the
 * page counts the rows it was sent, so a board longer than the response can
 * only under-award a band, never hand one out that isn't earned.
 */
export function topPercentBand(
  rank: number | null,
  size: number
): TopPercentBand | null {
  if (rank === null || rank <= 1 || rank > size) return null;
  for (const band of BANDS) {
    if (rank <= Math.floor((size * band) / 100)) return band;
  }
  return null;
}

/** What each band says: a short chip for the row, and a line to go with it. */
export const TOP_PERCENT_COPY: Record<
  TopPercentBand,
  { emoji: string; quip: string }
> = {
  1: { emoji: "💎", quip: "Top 1%. Rarer than most of the words you play." },
  5: { emoji: "🔥", quip: "Top 5%. Your ink is running hot." },
  10: { emoji: "✨", quip: "Top 10%. The ink is strong with this one." },
};
