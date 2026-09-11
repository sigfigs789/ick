/**
 * One-time announcements.
 *
 * Something shown to a player who hasn't met it yet, that stops showing the
 * moment they have. Keyed by feature name so the next thing worth announcing
 * can reuse this rather than growing its own flag: `hasSeen` asks whether the
 * announcement is still owed, `markSeen` retires it for good.
 *
 * Deliberately one bit per feature and nothing else -- no counters, no expiry.
 * An announcement that comes back is one nobody trusts, so seen is permanent,
 * and the honest limit is the usual one for browser-local state: clearing site
 * data means seeing it again.
 */

const SEEN_PREFIX = "ick:seen:";

/**
 * The features with a once-only appearance. Just the rules sheet, which opens
 * itself for a first-time player; the leaderboard had a tab badge here until
 * the boards stopped being new.
 */
export type Announcement = "instructions";

/**
 * Whether the player has already met this feature.
 *
 * Storage that can't be read at all reports *seen*, so a browser that has no
 * way to remember the dismissal shows nothing rather than an undismissable
 * announcement on every single load. A missed announcement is a much smaller
 * cost than a permanent nag.
 */
export function hasSeen(what: Announcement): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + what) !== null;
  } catch {
    return true;
  }
}

/** Retire this feature's announcement, permanently. */
export function markSeen(what: Announcement): void {
  try {
    localStorage.setItem(SEEN_PREFIX + what, "1");
  } catch {
    // Nothing to do, and nothing worth doing: a store that cannot be written is
    // one hasSeen cannot read either, so nothing was shown to begin with.
  }
}
