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

/** The features that have ever carried a badge, or a once-only appearance. */
export type Announcement = "instructions" | "freeform";

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

const SESSION_PREFIX = "ick:announced:";

/**
 * Whether this feature has already been announced in *this* browsing session.
 *
 * The bound on an announcement that repeats. `hasSeen` above is permanent and
 * answers "has this player ever met it"; this answers "have we already shown it
 * since they opened the app", so a reload, a tab switch or a back-navigation
 * cannot bring the same sheet back. A new session is a new open, which is the
 * unit "on open" means.
 *
 * Storage that can't be read reports *announced*, for the reason `hasSeen`
 * reports seen: a browser that cannot remember the showing would repeat it on
 * every render, and a missed announcement is much cheaper than that.
 */
export function announcedThisSession(what: Announcement): boolean {
  try {
    return sessionStorage.getItem(SESSION_PREFIX + what) !== null;
  } catch {
    return true;
  }
}

/** Record that this feature has been announced in this session. */
export function markAnnouncedThisSession(what: Announcement): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + what, "1");
  } catch {
    // Same as markSeen: a store that cannot be written is one the reader above
    // treats as already announced, so nothing was shown to record.
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
