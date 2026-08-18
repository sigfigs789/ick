import { track } from "@vercel/analytics";
import { rarityScore, type BaseFormSubstitution } from "./game/dictionary";
import { bestWord } from "./game/rank";
import { puzzleNumber } from "./game/share";
import { LIVE_HANDOFF_MS, type LiveCheck } from "./game/liveValidate";
import type {
  AcceptedWord,
  DailyProgress,
  RarityInfo,
  RejectionReason,
  StreakState,
} from "./game/types";
import { currentVisit, type VisitOutcome } from "./game/visits";
import { APP_VERSION } from "./version";

/**
 * Send game activity to Vercel without player-identifying information.
 */
export function trackAcceptedAnswer(
  date: string,
  word: AcceptedWord,
  answerCount: number,
  totalScore: number,
  streakDays: number
) {
  track("answer_accepted", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    answer_count: answerCount,
    word: word.word,
    score: rarityScore(word.zipf, date),
    total_score: totalScore,
    rarity: word.rarity,
    streak_days: streakDays,
  });
}

/** Record rejected submissions so the word list can be reviewed over time. */
export function trackRejectedAnswer(date: string, drop: string, rawWord: string) {
  track("answer_rejected", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: rawWord.trim().toLowerCase(),
  });
}

/** Record the specific rejection feedback shown to a player. */
export function trackRejectionMessage(date: string, reason: RejectionReason) {
  track("rejection_message_shown", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    rejection_reason: reason,
  });
}

/**
 * Record when an accepted word's rarity was inherited from a base form (a tense,
 * plural, or transparent/bound derivation) rather than its own frequency. Logs
 * the original word and the base it mapped to, with both words' scores, so the
 * base-form rules can be monitored for over- or under-scoring.
 */
export function trackBaseFormSubstitution(date: string, substitution: BaseFormSubstitution) {
  track("base_form_substituted", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    original_word: substitution.word,
    original_score: rarityScore(substitution.ownZipf, date),
    base_word: substitution.base,
    base_score: rarityScore(substitution.baseZipf, date),
  });
}

/**
 * Record an accepted word that had no measured frequency at all, so its score is
 * the system's stand-in value rather than anything derived from data (9.90 under
 * the current system -- see isUnattestedZipf). Fires once per accepted word, from
 * the single accept path, so its count against `answer_accepted` is the share of
 * accepted words scored by guess. `source` separates the two ways a word arrives
 * without a frequency: `curated` is a word in the list whose rarity.json entry is
 * the sentinel, `live` is a Merriam-Webster approval no frequency source attested.
 *
 * Deliberately its own event rather than a flag on `answer_accepted`: the count is
 * the thing being watched, and a distinct event reads directly off the dashboard
 * without filtering on a custom property.
 */
export function trackUnattestedScore(
  date: string,
  word: AcceptedWord,
  source: "curated" | "live"
) {
  track("unattested_score_used", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    word: word.word,
    source,
    score: rarityScore(word.zipf, date),
    rarity: word.rarity,
  });
}

/**
 * Record a word the live Merriam-Webster fallback approved -- a word absent from
 * the curated list that MW attests as ordinary, current and inoffensive. Carries
 * the rarity it was scored at so the additions can be reviewed for balance, and
 * `attested` distinguishes a real measured frequency from the unattested floor.
 * `applied` is false when the verdict arrived too late to count (the puzzle had
 * already finished), so approvals that never reached the player are separable.
 */
export function trackMerriamWebsterApproved(
  date: string,
  drop: string,
  check: LiveCheck,
  info: RarityInfo,
  applied: boolean
) {
  track("merriam_webster_approved", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: check.word,
    rarity: info.rarity,
    score: rarityScore(info.zipf, date),
    zipf: Math.round(info.zipf * 100) / 100,
    attested: check.zipf !== null,
    first_use: check.firstUse ?? "unknown",
    pos: check.pos.join(",") || "unknown",
    mw_source: check.source ?? "unknown",
    elapsed_ms: check.elapsedMs,
    within_handoff: check.elapsedMs <= LIVE_HANDOFF_MS,
    applied,
  });
}

/**
 * Record a live lookup that failed, with the reason it failed. The reasons worth
 * watching: `quota-exceeded` (MW's 1,000/day non-commercial cap is spent),
 * `invalid-key` (a key was rotated or is wrong for that reference),
 * `unconfigured` (no keys set on the deployment), plus network, timeout and
 * malformed-response cases. A failure says nothing about the word itself.
 */
export function trackMerriamWebsterFailed(date: string, drop: string, check: LiveCheck) {
  // A half-broken lookup carries its problem in `failure` while the top-level
  // fields describe the verdict, so the failure object is the source of truth.
  const failure = check.failure;
  track("merriam_webster_failed", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: check.word,
    reason: failure?.reason ?? check.reason ?? "unknown",
    detail: (failure?.detail ?? check.detail ?? "").slice(0, 200) || "none",
    status: failure?.status ?? check.status ?? 0,
    partial: check.outcome !== "error",
    elapsed_ms: check.elapsedMs,
  });
}

/** Record player suggestions for future curated-list reviews. */
export function trackWordSuggestion(rawWord: string) {
  track("word_suggested", { word: rawWord.trim().toLowerCase() });
}

export function trackPuzzleCompleted(
  progress: DailyProgress,
  completionMethod: "locked_in" | "all_answers",
  streak: StreakState
) {
  const best = bestWord(progress.acceptedWords);
  track("puzzle_completed", {
    puzzle_date: progress.date,
    puzzle_number: puzzleNumber(progress.date),
    answer_count: progress.acceptedWords.length,
    best_score: best ? rarityScore(best.zipf, progress.date) : 0,
    best_rarity: best?.rarity ?? "None",
    best_word: best?.word ?? "None",
    won: progress.won ?? false,
    completion_method: completionMethod,
    streak_days: streak.currentStreak,
  });
}

/**
 * Origin and retention dimensions for the current player, attached to share
 * events so a share can be attributed to where the sharer first arrived from
 * and whether they are a first-timer or a returning visitor.
 */
function visitDimensions() {
  const state = currentVisit();
  return {
    source: visitSource(state?.source ?? null),
    last_source: visitSource(state?.lastSource ?? null),
    visit_type: state && state.timesReturned > 0 ? "returning" : "first",
    times_returned: state?.timesReturned ?? 0,
    days_returned: state?.daysReturned ?? 0,
  };
}

/** Record a successful copy from the standard Share button. */
export function trackResultCopied() {
  track("result_copied", { method: "copy", ...visitDimensions() });
}

/** Record a click on the X share button. */
export function trackResultSharedOnX() {
  track("result_shared_on_x", { method: "x", ...visitDimensions() });
}

/** Record visitors who arrive through an X share link. */
export function trackTwitterArrival() {
  track("arrived_from_twitter");
}

/** Record visitors who arrive through a copied Share link. */
export function trackShareArrival() {
  track("arrived_from_share");
}

/** Record visitors who arrive through a tagged Reddit link (`s=r`). */
export function trackRedditArrival() {
  track("arrived_from_reddit");
}

/** Map compact arrival codes to readable analytics source labels. */
function visitSource(code: string | null): string {
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  if (code === "r") return "reddit";
  return code ?? "direct";
}

/** The shared dimensions carried by both visit events so they line up 1:1. */
function visitProperties(outcome: VisitOutcome) {
  return {
    // The build the tab is actually running, which is not necessarily the newest
    // deploy: a tab only reloads when its baked-in version falls below the served
    // minVersion (see useForceUpdate), so optional deploys leave older tabs alive.
    app_version: APP_VERSION,
    visit_type: outcome.isFirstVisit ? "first" : "returning",
    source: visitSource(outcome.state.source),
    last_source: visitSource(outcome.state.lastSource ?? null),
    times_returned: outcome.state.timesReturned,
    days_returned: outcome.state.daysReturned,
    new_day: outcome.isNewDay,
  };
}

/**
 * Record each first-of-session app open, tagged as a first-ever visit or a
 * return. Carries the arrival source and both retention counters so returning
 * visitors can be measured by count, by distinct days, and by origin.
 */
export function trackVisit(outcome: VisitOutcome) {
  track("site_visit", visitProperties(outcome));
}

/**
 * Record that a visit produced an actual submission rather than just an open
 * and close. Carries the same params as `site_visit`, so comparing the two by
 * source or return count gives the share of visits that convert to play.
 */
export function trackVisitEngaged(outcome: VisitOutcome) {
  track("visit_engaged", visitProperties(outcome));
}

/** Convert compact share-link codes into analytics campaign sources. */
export function campaignSourceFromSearch(search: string): "share" | "twitter" | "reddit" | null {
  const code = new URLSearchParams(search).get("s");
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  if (code === "r") return "reddit";
  return null;
}
