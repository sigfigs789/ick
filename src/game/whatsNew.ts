/**
 * One-time "new" markers.
 *
 * A badge pointing at something the player hasn't found yet, that stops
 * pointing the moment they have. Keyed by feature name so the next thing worth
 * announcing can reuse this rather than growing its own flag: `hasSeen` asks
 * whether the badge is still owed, `markSeen` retires it for good.
 *
 * Deliberately one bit per feature and nothing else -- no counters, no expiry.
 * A badge that comes back is a badge nobody trusts, so seen is permanent, and
 * the honest limit is the usual one for browser-local state: clearing site data
 * means seeing it again.
 */

const SEEN_PREFIX = "ick:seen:";

/** The features that have ever carried a badge. */
export type Announcement = "leaderboard";

/**
 * Whether the player has already met this feature.
 *
 * Storage that can't be read at all reports *seen*, so a browser that has no
 * way to remember the dismissal shows no badge rather than an undismissable one
 * on every single load. A missed announcement is a much smaller cost than a
 * permanent nag.
 */
export function hasSeen(what: Announcement): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + what) !== null;
  } catch {
    return true;
  }
}

/** Retire this feature's badge, permanently. */
export function markSeen(what: Announcement): void {
  try {
    localStorage.setItem(SEEN_PREFIX + what, "1");
  } catch {
    // Nothing to do, and nothing worth doing: a store that cannot be written is
    // one hasSeen cannot read either, so no badge was drawn to begin with.
  }
}
