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
import { loadPlayerId } from "./game/player";
import { modeForDate, type GameMode } from "./game/mode";
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
 *
 * Every row carries `player_id`, the board identity (see game/player.ts), so
 * the log can be read per player rather than only per event: which mode a player
 * settles on, whether a switch sticks, whether they come back the next day. None
 * of that is a count of events. Added here rather than at each call so no event
 * can be written without it, and only here -- Vercel's dashboard has no way to
 * group by a UUID, and every property it is sent costs one of the few it keeps.
 * Null for a browser that has no id yet or cannot store one.
 *
 * Checks `reporting` itself as well as through `send`, because a couple of
 * events address this sink directly and the id must never leave a host that has
 * reporting off -- inside a Reddit post it is the player's account name.
 */
function mirror(name: string, props?: EventProps): void {
  if (import.meta.env.MODE === "test" || !reporting) return;
  try {
    const body = JSON.stringify({ name, props: { ...props, player_id: loadPlayerId() } });
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
/**
 * Whether this host reports anything at all.
 *
 * True on this site, which is what all of the above is for. False inside a
 * Reddit post, and not as a preference: the frame's content policy blocks
 * Vercel's scripts outright, and `/api/events` is a path that build does not
 * serve -- so every event would be a blocked script and a request into nothing.
 *
 * There is a better reason than either. Reporting from inside a post would send
 * what Reddit's players do to a third party, which is the one thing that build
 * is careful not to do anywhere else.
 */
let reporting = true;

/** Turn reporting off, for a host that must not do it. Call before rendering. */
export function setReporting(enabled: boolean): void {
  reporting = enabled;
}

/** Whether events are being reported, for the components that mount the SDKs. */
export function isReporting(): boolean {
  return reporting;
}

function send(name: string, props?: EventProps): void {
  if (!reporting) return;
  // Called with one argument when there are no properties, exactly as before, so
  // an event with no dimensions still reaches Vercel as a bare event name.
  if (props) track(name, props);
  else track(name);
  mirror(name, props);
}

/**
 * Send game activity to Vercel.
 *
 * What identity may ride along, since this used to say "without
 * player-identifying information" and that was broader than the real rule: the
 * board identity is fine to send. It is a UUID this browser invented, and the
 * name shown beside it is computed from that UUID rather than typed by anyone
 * (see game/player.ts, game/handle.ts) -- there is nobody behind it to identify.
 *
 * The thing that must never be reported is a Reddit login, and it cannot be:
 * an account name exists only inside a Reddit post, and that build turns
 * reporting off outright (see devvit/src/client/game.tsx, which calls both
 * `setAccount` and `setReporting(false)`). The guarantee is the switch, not the
 * omission of a field here.
 */
/**
 * Which rules a puzzle was played under, on every event about playing one.
 *
 * A dimension rather than an event, because the question the modes raise is not
 * "who switches" -- it is whether the two are the same game. Every number the
 * dashboard already carries (how many words a player banks, what they score,
 * how often they finish, how often a guess is refused, how often the live lookup
 * is reached for) is worth knowing per mode, and none of that is answerable from
 * a switch event alone.
 *
 * Off the puzzle's date rather than off the switch's current position, so an
 * archived day reports the mode it was actually played in.
 */
function modeOf(date: string): GameMode {
  return modeForDate(date);
}

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
    mode: modeOf(date),
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

/**
 * The player traded their unspent retry for a look at the day's word (see
 * DropDisplay). Counted separately from `answer_retried`: both spend the same
 * allowance, but one takes a word back and this one buys a spoiler, and how
 * often players prefer the spoiler is the question worth watching.
 */
export function trackAnswerRevealed(date: string, answerCount: number) {
  send("answer_revealed", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    answer_count: answerCount,
  });
}

/** Record rejected submissions so the word list can be reviewed over time. */
export function trackRejectedAnswer(date: string, drop: string, rawWord: string) {
  send("answer_rejected", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    mode: modeOf(date),
    drop: drop.toLowerCase(),
    word: rawWord.trim().toLowerCase(),
  });
}

/** Record the specific rejection feedback shown to a player. */
export function trackRejectionMessage(date: string, reason: RejectionReason) {
  send("rejection_message_shown", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    mode: modeOf(date),
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
  applied: boolean,
  /**
   * The register Merriam-Webster refused the word for, on a week that banked it
   * anyway -- null for an ordinary approval. Worth a field of its own rather
   * than being read back off `outcome`: it is the number that says how much of
   * freeform week's reach came from lifting the register rules, which is most of
   * what the trial is deciding.
   */
  waived: string | null = null
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
    waived,
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
 * Record free-text feedback left in the How to play panel.
 *
 * The box takes a note of any length, and the whole of it goes to the Supabase
 * mirror, which is what the feedback review page reads. Vercel Analytics caps a
 * property value at 255 characters, so the copy on its dashboard is the opening
 * of the note; the two sinks are addressed separately here rather than through
 * `send` so that difference is visible instead of costing the full text.
 */
const VERCEL_VALUE_CHARS = 255;

export function trackFeedbackSubmitted(rawFeedback: string) {
  const note = rawFeedback.trim();
  track("feedback_submitted", { feedback: note.slice(0, VERCEL_VALUE_CHARS) });
  mirror("feedback_submitted", { feedback: note });
}

/**
 * The verdict on Freeform week: one tap, "love" or "boo".
 *
 * This is the vote the trial is actually decided on, so it is sent on the tap
 * rather than held until the note beside it is written -- most people will press
 * a button and nothing else, and a vote that only counts when accompanied by an
 * essay is a vote from the people who write essays.
 *
 * `date` is the puzzle they were looking at when they voted, which is what makes
 * the tally readable afterwards: a vote cast on the 14th is a first impression
 * and one cast on the 20th is a week's experience, and the week is short enough
 * that the difference is most of what there is to learn.
 *
 * `voter` is what makes the tally a count of people rather than of taps. Without
 * it a row says only that somebody somewhere pressed love, so one player who
 * changed their mind twice and three players who agreed are the same three rows,
 * and a trial decided on that count is decided on nothing. With it the read is
 * the latest row per voter, which is the behaviour the sheet has always claimed
 * (see components/FreeformModal.tsx) and could not deliver.
 *
 * It is the board identity, minted on open and already sent with every score --
 * not a new thing to carry, and nothing personal: a UUID this browser invented
 * (see game/player.ts). It goes to both sinks through `send`, so the tally is
 * the same one wherever it is read. Null where a browser has no id at all
 * (private browsing with storage off); such a vote still counts, it just cannot
 * be collapsed with another from the same person.
 *
 * Fire-and-forget through `send`, like every other event here -- a vote must
 * never be able to interrupt the game it is about.
 */
export function trackFreeformVote(vote: "love" | "boo", date: string) {
  send("freeform_vote", { vote, date, voter: loadPlayerId() });
}

/**
 * The free-text note left under the Freeform week vote.
 *
 * Split from the vote rather than sent with it, because the two are given at
 * different moments and either can arrive without the other. Addressed to both
 * sinks by hand for the same reason `trackFeedbackSubmitted` is: Vercel truncates
 * a property at 255 characters and the Supabase mirror is what gets read.
 *
 * The vote is carried along when there is one, so a note can be read next to the
 * verdict it explains without joining two tables on a timestamp. The voter id
 * goes with it for the same reason it goes on the vote: it is what ties a note
 * to the verdict that player ended up on, including one they cast later or in
 * another session.
 */
export function trackFreeformFeedback(
  rawFeedback: string,
  date: string,
  vote: "love" | "boo" | null
) {
  const note = rawFeedback.trim();
  const voter = loadPlayerId();
  track("freeform_feedback", {
    feedback: note.slice(0, VERCEL_VALUE_CHARS),
    date,
    vote,
    voter,
  });
  mirror("freeform_feedback", { feedback: note, date, vote, voter });
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
    // The record's own, when it carries one: a puzzle finished after the player
    // flipped the switch was still played under the rules it was played under.
    mode: progress.mode ?? modeOf(progress.date),
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
 * header tab and the post-game link are two different moments; and joining,
 * which is the one of the two that is a commitment. No score or name is sent --
 * those live in the leaderboard's own table, and duplicating them here would put
 * a display name in the analytics stream for no reason. Nothing records which
 * board was looked at, because all three are on screen at once.
 */
export function trackLeaderboardOpened(from: "header" | "results") {
  send("leaderboard_opened", { from });
}

/**
 * The other page behind the header, opened.
 *
 * Its own event rather than a third `from` on the one above, because it is a
 * different page now: the finds used to be the bottom half of the leaderboard,
 * so every open of that page was an open of both and one event could honestly
 * stand for them. Split apart, "did anybody go and read the words" is a
 * question only this can answer.
 */
export function trackFoundWordsOpened(from: "header" | "results") {
  send("found_words_opened", { from });
}

/**
 * The player moved the switch between Standard and Freeform.
 *
 * Both ends, not just the destination: "went to Freeform" and "came back from
 * Freeform" are different facts about the same player, and a single field cannot
 * tell them apart on its own.
 *
 * Fired only when a person presses the control -- not when the mode is restored
 * from storage on load, which is not a decision anybody made today and would
 * turn this into a visit count that already exists. What the *steady state*
 * looks like is answered by the `mode` dimension on every play event, which is
 * the more useful half of the two.
 */
export function trackModeChanged(from: GameMode, to: GameMode) {
  send("mode_changed", { from, to });
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
