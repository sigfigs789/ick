/**
 * The top-three places the player has been seen at on the streak board, for the
 * badges they earn (see game/achievements.ts). Noted wherever the game reads the
 * player's rank -- the climb check and the board itself (see game/streakClimb.ts)
 * -- and kept on this device, like the rest of the record.
 */

const PLACINGS_KEY = "ick:streakPlacings";

/** The top-three places on the streak board, the badges' (see game/achievements.ts). */
export const STREAK_PLACES = [1, 2, 3] as const;
export type StreakPlace = (typeof STREAK_PLACES)[number];

/** The first day the player was seen at each top-three place or above it. */
export type StreakPlacings = Partial<Record<StreakPlace, string>>;

/** The top-three places this browser has seen the player hold, each with its first day. */
export function streakPlacings(): StreakPlacings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PLACINGS_KEY) ?? "{}");
    if (!stored || typeof stored !== "object") return {};
    const placings: StreakPlacings = {};
    for (const place of STREAK_PLACES) {
      const date = (stored as Record<string, unknown>)[place];
      if (typeof date === "string") placings[place] = date;
    }
    return placings;
  } catch {
    return {};
  }
}

/** Note that the player held `rank` on `date`'s streak board. */
export function rememberPlacing(rank: number, date: string): void {
  const placings = streakPlacings();
  const fresh = STREAK_PLACES.filter((place) => rank <= place && !placings[place]);
  if (fresh.length === 0) return;
  for (const place of fresh) placings[place] = date;
  try {
    localStorage.setItem(PLACINGS_KEY, JSON.stringify(placings));
  } catch {
    // Unwritable storage only means the badge waits for a look that sticks.
  }
}
