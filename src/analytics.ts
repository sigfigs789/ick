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
import { markShare, type SessionTimeReport } from "./game/sessionTime";
import { APP_VERSION } from "./version";

/** The scalar property values both Vercel Analytics and /api/events accept. */
type EventProps = Record<string, string | number | boolean | null>;

/**
 * Mirror one event into Supabase, alongside the copy Vercel Analytics receives.
 *
 * Fire-and-forget by construction: `sendBeacon` hands the request to the browser,
 * which delivers it on its own time and even after the page goes away, and there
 * is no response to read. Nothing about the game waits on this or changes if it
 * fails -- the dictionary the game plays against is the shipped one, and this
 * endpoint is write-only.
 *
 * Skipped under test, where there is no server to post to and a stray request
 * would be noise. `npm run dev` does serve /api/events (see vite.config.ts), so
 * the path is exercisable locally.
 */
function mirror(name: string, props?: EventProps): void {
  if (import.meta.env.MODE === "test") return;
  try {
    const body = JSON.stringify(props ? { name, props } : { name });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    // Older Safari has no sendBeacon; `keepalive` gets the same survive-unload
    // behaviour out of fetch.
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Recording an event must never be able to break the move that produced it.
  }
}

/**
 * Record one event in both places: Vercel Analytics, which every event here has
 * always gone to, and the game's own Supabase table, which keeps it queryable
 * past the dashboard's retention window. Vercel is called first so a problem with
 * the mirror cannot cost the event its primary destination.
 */
function send(name: string, props?: EventProps): void {
  // Called with one argument when there are no properties, exactly as before, so
  // an event with no dimensions still reaches Vercel as a bare event name.
  if (props) track(name, props);
  else track(name);
  mirror(name, props);
}

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
  send("answer_accepted", {
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

/**
 * Record a word set aside with the puzzle's one retry (see storage.retryWord).
 *
 * Carries the dropped word's score and where it sat among the day's guesses, so
 * the obvious question -- whether players spend the retry on a genuinely bad
 * word or reflexively on whatever they just typed -- is answerable, along with
 * how often the retry gets used at all.
 */
export function trackAnswerRetried(
  date: string,
  word: AcceptedWord,
  guessIndex: number,
  answerCount: number
) {
  send("answer_retried", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    word: word.word,
    score: rarityScore(word.zipf, date),
    rarity: word.rarity,
    // One-based, to read the same way the guess log numbers them.
    guess_index: guessIndex + 1,
    // How many words were banked at the moment the retry was spent, so an early
    // retry and a last-guess one are told apart.
    answer_count: answerCount,
  });
}

/** Record rejected submissions so the word list can be reviewed over time. */
export function trackRejectedAnswer(date: string, drop: string, rawWord: string) {
  send("answer_rejected", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    drop: drop.toLowerCase(),
    word: rawWord.trim().toLowerCase(),
  });
}

/** Record the specific rejection feedback shown to a player. */
export function trackRejectionMessage(date: string, reason: RejectionReason) {
  send("rejection_message_shown", {
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
  send("base_form_substituted", {
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
 * the system's stand-in value rather than anything derived from data (the perfect
 * 10 the sentinel earns -- see isUnattestedZipf). Fires once per accepted word, from
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
  send("unattested_score_used", {
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
  send("merriam_webster_approved", {
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
  send("merriam_webster_failed", {
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

/**
 * Record free-text feedback left in the How to play panel. Trimmed and capped at
 * 200 characters so a long note still lands as a single readable property value.
 */
export function trackFeedbackSubmitted(rawFeedback: string) {
  send("feedback_submitted", { feedback: rawFeedback.trim().slice(0, 200) });
}

/** Record player suggestions for future curated-list reviews. */
export function trackWordSuggestion(rawWord: string) {
  send("word_suggested", { word: rawWord.trim().toLowerCase() });
}

export function trackPuzzleCompleted(progress: DailyProgress, streak: StreakState) {
  const best = bestWord(progress.acceptedWords);
  send("puzzle_completed", {
    puzzle_date: progress.date,
    puzzle_number: puzzleNumber(progress.date),
    answer_count: progress.acceptedWords.length,
    best_score: best ? rarityScore(best.zipf, progress.date) : 0,
    best_rarity: best?.rarity ?? "None",
    best_word: best?.word ?? "None",
    won: progress.won ?? false,
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
  markShare();
  send("result_copied", { method: "copy", ...visitDimensions() });
}

/** Record a click on the X share button. */
export function trackResultSharedOnX() {
  markShare();
  send("result_shared_on_x", { method: "x", ...visitDimensions() });
}

/** Record visitors who arrive through an X share link. */
export function trackTwitterArrival() {
  send("arrived_from_twitter");
}

/** Record visitors who arrive through a copied Share link. */
export function trackShareArrival() {
  send("arrived_from_share");
}

/** Record visitors who arrive through a tagged Reddit link (`s=r`). */
export function trackRedditArrival() {
  send("arrived_from_reddit");
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
  send("site_visit", visitProperties(outcome));
}

/**
 * Record that a visit produced an actual submission rather than just an open
 * and close. Carries the same params as `site_visit`, so comparing the two by
 * source or return count gives the share of visits that convert to play.
 */
export function trackVisitEngaged(outcome: VisitOutcome) {
  send("visit_engaged", visitProperties(outcome));
}

/**
 * Record how long this session lasted, and where its landmarks fell: the first
 * guess, the last one, and the share. Every time is visible time from the start
 * of the session, so `time_to_last_guess_ms` against `visible_ms` is the tail
 * spent after play stopped. Fires when the page hides or unloads rather than on a close event no
 * browser reliably provides, so a long session that is backgrounded and picked
 * up again sends more than one report -- `session_id` groups them, `visible_ms`
 * is the running total, and `segment_ms` is only the new time, so neither
 * `max(visible_ms)` nor `sum(segment_ms)` double-counts (see game/sessionTime).
 *
 * Carries the same origin and cohort dimensions as a share, so time on site can
 * be sliced by where the player arrived from and whether they are returning.
 */
export function trackSessionTime(report: SessionTimeReport) {
  send("session_time", {
    session_id: report.sessionId,
    visible_ms: report.visibleMs,
    total_ms: report.totalMs,
    segment_ms: report.segmentMs,
    time_to_first_guess_ms: report.timeToFirstGuessMs,
    from_first_guess_ms: report.fromFirstGuessMs,
    time_to_last_guess_ms: report.timeToLastGuessMs,
    guess_count: report.guessCount,
    time_to_share_ms: report.timeToShareMs,
    shared: report.shared,
    guessed: report.guessed,
    report_number: report.reportNumber,
    ...visitDimensions(),
  });
}

/**
 * Leaderboard interest, in two events: opening it, and from where, since the
 * header button and the post-game link are two different moments; and joining,
 * which is the one of the two that is a commitment. No score or name is sent --
 * those live in the leaderboard's own table, and duplicating them here would put
 * a display name in the analytics stream for no reason. Nothing records which
 * board was looked at, because both are on screen at once.
 */
export function trackLeaderboardOpened(from: "header" | "results") {
  send("leaderboard_opened", { from });
}

export function trackLeaderboardJoined(isRename: boolean) {
  send("leaderboard_joined", { rename: isRename });
}

/** Convert compact share-link codes into analytics campaign sources. */
export function campaignSourceFromSearch(search: string): "share" | "twitter" | "reddit" | null {
  const code = new URLSearchParams(search).get("s");
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  if (code === "r") return "reddit";
  return null;
}
