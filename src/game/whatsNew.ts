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

/**
 * The features that have ever carried a badge, or a once-only appearance.
 *
 * "freeform" and "freeform-badge" are one week's announcement told two ways,
 * and they are two bits because they are met two ways. The sheet is read; the
 * badge is only looked at. A player who watched the badge time out has seen
 * that something changed, which is all the badge ever claimed to say -- it has
 * no business also spending the one automatic opening of the sheet that
 * actually explains the change.
 *
 * "freeform-extended-badge" is a third bit for a second piece of news on the
 * same button. Extending the week is not what the first badge announced, so a
 * player who dismissed "Scoring update" has not been told about it, and reusing
 * that bit would mean the people most likely to care -- the ones who read the
 * first announcement -- are exactly the ones who never see the second.
 */
export type Announcement =
  | "instructions"
  | "freeform"
  | "freeform-badge"
  | "freeform-extended-badge";

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

/**
 * The puzzle date from which the header's badge announces the extension rather
 * than the scoring change.
 *
 * A date rather than a flag, so the switch happens on its own and the two
 * announcements cannot overlap: before it the badge is the week's opening news,
 * on and after it the badge is the extension, and there is never a moment with
 * two badges competing for one button.
 */
export const FREEFORM_EXTENDED_START = "2026-09-20";

/** What the header's badge says, and which bit retires it. */
export interface FreeformBadge {
  key: Announcement;
  label: string;
}

/**
 * Which announcement the Freeform badge is carrying on `date`.
 *
 * One badge at a time, chosen by the calendar. The label and the storage key
 * travel together because they have to agree -- a badge dismissed under one
 * wording must not come back wearing the other, and a new wording that reused
 * the old bit would never appear for the players who already dismissed it.
 *
 * Compared as strings like every other cutover in this app, so it turns over
 * with the puzzle rather than with a clock.
 */
export function freeformBadgeFor(date: string): FreeformBadge {
  if (date >= FREEFORM_EXTENDED_START) {
    return {
      key: "freeform-extended-badge",
      label: "Freeform extended by 1 week",
    };
  }
  return { key: "freeform-badge", label: "Scoring update" };
}
