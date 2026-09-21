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

import { MODE_CHOICE_START } from "./mode";

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
  | "freeform-extended-badge"
  /**
   * The fourth bit, for the news that the week became a switch. Its own again,
   * and for the same reason: a player who dismissed "Freeform extended 1 week"
   * was told the trial was running longer, not that it had ended and left a
   * control behind. Reusing that bit would hide the switch from exactly the
   * players who read the announcements.
   */
  | "mode-toggle-badge";

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
 * The puzzle date from which the header's badge announced the extension rather
 * than the week's opening scoring change.
 *
 * Both of those announcements are over -- see `headerBadgeFor`. The constant is
 * kept because the two bits it chose between are still in the union above and
 * still sitting in players' storage, and a date that explains a stored key is
 * worth more than one less line.
 */
export const FREEFORM_EXTENDED_START = "2026-09-20";

/** What the header's badge says, and which bit retires it. */
export interface HeaderBadge {
  key: Announcement;
  label: string;
}

/**
 * The badge the header is carrying on `date`, or none.
 *
 * One badge at a time, chosen by the calendar, with the label and the storage
 * key travelling together because they have to agree -- a badge dismissed under
 * one wording must not come back wearing the other, and a new wording that
 * reused the old bit would never appear for the players who already dismissed
 * it.
 *
 * There is exactly one now: "Change mode", pointing at the switch the trial
 * week left behind (see game/mode.ts). The week's own two announcements are
 * gone with the week -- their button is a control now rather than a notice, and
 * a badge saying the trial has been extended would be pointing at something
 * that is no longer true.
 *
 * Null before MODE_CHOICE_START, because there is nothing to point at: the
 * switch is not on the header yet, and a badge floating under the "?" would be
 * marking the rules button as new.
 *
 * Compared as a string like every other cutover in this app, so it turns over
 * with the puzzle rather than with a clock.
 */
export function headerBadgeFor(date: string): HeaderBadge | null {
  if (date < MODE_CHOICE_START) return null;
  return { key: "mode-toggle-badge", label: "Change mode" };
}
