import { track } from "@vercel/analytics";
import {
  isUnattestedZipf,
  rarityScore,
  scoredFromEstimate,
  type BaseFormSubstitution,
} from "./game/dictionary";
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
import { currentVisit, markSessionEngaged, markSessionInteracted, type VisitOutcome } from "./game/visits";
import { markLook, markShare, type SessionTimeReport } from "./game/sessionTime";
import { todayDateString } from "./game/date";
import { parseSourceCode, type ModeAssignment } from "./game/onboarding";
import { IDLE_HINT_DELAY_MS, currentIdleHintArm, type IdleHintArm } from "./game/idleHint";
import { APP_VERSION } from "./version";
import { isBotUserAgent } from "./game/botUa";
import { uiVariant, type UiVariantAssignment } from "./game/uiVariant";
import { visitorTag } from "./game/visitor";

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
    // The play-screen variant rides on every row for the same reason the id
    // does: the experiment is read per player, across every event they send.
    // So is a known visitor's tag (see game/visitor.ts), and only when there is
    // one: the report sets those browsers apart from the players.
    const visitor = visitorTag();
    const body = JSON.stringify({
      name,
      props: {
        ...props,
        player_id: loadPlayerId(),
        ui_variant: uiVariant(),
        ...(visitor ? { visitor } : {}),
      },
    });
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

/**
 * `mirrorOnly` rides along to Supabase alone: ids that join rows to each other,
 * which Vercel can do nothing with and would spend one of its few kept
 * properties on (see `mirror`).
 */
function send(name: string, props?: EventProps, mirrorOnly?: EventProps): void {
  if (!reporting) return;
  // Called with one argument when there are no properties, exactly as before, so
  // an event with no dimensions still reaches Vercel as a bare event name.
  if (props) track(name, props);
  else track(name);
  mirror(name, mirrorOnly ? { ...props, ...mirrorOnly } : props);
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
    score_source: scoreSource(date, word),
  }, idleHintArmProps());
}

/**
 * Where an accepted word's score came from: a corpus measurement, Claude's
 * estimate (src/data/estimated-zipf.json), or the unattested sentinel's flat
 * 10.00. Rides on `answer_accepted` so every play number the report already
 * draws from that event can be split by it -- the estimates are a guess, and
 * the point of recording this is to see what the guesses did to the game.
 */
export function scoreSource(date: string, word: AcceptedWord): "measured" | "estimated" | "unattested" {
  if (scoredFromEstimate(word.word, word.zipf, date)) return "estimated";
  return isUnattestedZipf(word.zipf) ? "unattested" : "measured";
}

/**
 * Record an accepted word scored from Claude's estimated Zipf, the counterpart
 * of `unattested_score_used` for the words that no longer fall to the sentinel.
 * Its own event for the same reason that one is: the count is the thing being
 * watched. Carries the score the estimate earned so the report can show where
 * the guesses landed on the scale.
 */
export function trackEstimatedScore(date: string, word: AcceptedWord) {
  send("estimated_score_used", {
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    mode: modeOf(date),
    word: word.word,
    zipf: word.zipf,
    score: rarityScore(word.zipf, date),
    rarity: word.rarity,
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
  }, idleHintArmProps());
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
    // The live puzzle, so the analytics page's today window can count a share
    // or a session by the puzzle it belongs to rather than by the clock.
    puzzle_date: todayDateString(),
  };
}

/**
 * Record a successful copy from the standard Share button. `mode` is the mode
 * the shared puzzle was played in, which is also the one its link carries.
 */
export function trackResultCopied(mode: GameMode) {
  markShare();
  send("result_copied", { method: "copy", mode, ...visitDimensions() }, idleHintArmProps());
}

/**
 * Record visitors who arrive through an X share link, with the mode the link
 * was shared from -- `none` for a link from before links carried one -- and the
 * puzzle they landed on, so the report counts arrivals per puzzle.
 */
export function trackTwitterArrival(mode: GameMode | null) {
  send("arrived_from_twitter", { mode: mode ?? "none", puzzle_date: todayDateString() });
}

/** Record visitors who arrive through a copied Share link. */
export function trackShareArrival(mode: GameMode | null) {
  send("arrived_from_share", { mode: mode ?? "none", puzzle_date: todayDateString() });
}

/**
 * The mode a brand-new player was started in, and why (see game/onboarding.ts).
 *
 * Sent once per browser, ever. It is the row the starting-mode report joins
 * every later play and share to by `player_id`, so it has to be sent after the
 * board id exists -- see Root.tsx.
 */
export function trackModeAssigned(assignment: ModeAssignment) {
  send("mode_assigned", {
    mode: assignment.mode,
    reason: assignment.reason,
    source: visitSource(assignment.source),
    puzzle_date: assignment.date,
  });
}

/**
 * The play-screen variant a browser was put in (see game/uiVariant.ts). Sent once
 * per browser, ever, after the board id exists -- the row the report's UI test
 * section groups players by.
 */
export function trackUiVariantAssigned(assignment: UiVariantAssignment) {
  send("ui_variant_assigned", {
    variant: assignment.variant,
    visit_type: assignment.visitType,
    puzzle_date: todayDateString(),
  });
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
    // The live puzzle, for the analytics page's today window (see visitDimensions).
    puzzle_date: todayDateString(),
  };
}

/**
 * The id of the visit itself, the same on its open, its engagement and its first
 * press, so the report can count engaged visits once each however many of those
 * events a visit sent. Null for a session recorded before visits had one.
 */
function visitId(outcome: VisitOutcome) {
  return { visit_id: outcome.visitId ?? null };
}

/**
 * Record each first-of-session app open, tagged as a first-ever visit or a
 * return. Carries the arrival source and both retention counters so returning
 * visitors can be measured by count, by distinct days, and by origin.
 */
export function trackVisit(outcome: VisitOutcome) {
  send("site_visit", visitProperties(outcome), { ...visitId(outcome), ...botSignals() });
}

/**
 * What the browser says about itself that tells an automated visit from a
 * person, on `site_visit` only and to Supabase alone: `webdriver` is set by
 * every driven browser that plays by the spec, `bot_ua` is the user agent naming
 * itself a bot (the raw string is never sent), and `visibility` is whether the
 * page was even on screen when it loaded. The /analytics page drops a player any
 * of the first two flag (see analytics_overview).
 */
function botSignals(): EventProps {
  try {
    return {
      webdriver: typeof navigator !== "undefined" && navigator.webdriver === true,
      bot_ua: typeof navigator !== "undefined" && isBotUserAgent(navigator.userAgent),
      visibility: typeof document !== "undefined" ? document.visibilityState : null,
    };
  } catch {
    return {};
  }
}

/** What first made a visit more than an open and a close. */
export type EngagedVia = "guess" | "leaderboard" | "found_words";

/**
 * Record that a visit did something rather than just open and close: submitted
 * a guess, or opened the leaderboard or the found words. Carries the same params
 * as `site_visit`, so comparing the two by source or return count gives the
 * share of visits that engage, plus `via`, the first of those three things the
 * visit did -- once per session, so a look followed by a guess is one row with
 * `via: "leaderboard"`. Rows from before looking counted have no `via`, and
 * every one of them was a guess.
 */
export function trackVisitEngaged(outcome: VisitOutcome, via: EngagedVia = "guess") {
  send("visit_engaged", { ...visitProperties(outcome), via }, visitId(outcome));
}

/** What can be pressed: a click anywhere else on the page is not a decision. */
const PRESSABLE =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="menuitem"], [role="checkbox"]';

/** What a press inside of, or a key while it is open, is not an interaction. */
const NOT_INTERACTION = "[data-not-interaction]";

/** Keys that only change what the next key means. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

/**
 * Record, once per session, that the visit did anything at all: the first press
 * of any button, link, field or key. The engaged-visit funnel counts only a
 * guess or a look; this is the broader "not an open-and-close", which is what
 * the analytics page's engaged and idle visitor counts read. Carries the same
 * params as `site_visit`, `puzzle_date` among them, so the today window can
 * count it by puzzle.
 *
 * Presses on the How to play sheet do not count, and nor do keys while it is
 * open: dismissing the instructions a first visit opens with is not doing
 * anything. The sheet marks itself with `data-not-interaction`.
 *
 * Listens in the capture phase so a control that stops propagation still
 * counts, and stops listening after the first press or once the session has
 * already reported one. Returns the cleanup for a React effect.
 */
export function watchFirstInteraction(): () => void {
  if (typeof document === "undefined") return () => {};
  const report = () => {
    stop();
    const outcome = markSessionInteracted();
    if (outcome) send("visit_interacted", visitProperties(outcome), visitId(outcome));
  };
  const onClick = (e: MouseEvent) => {
    if (!(e.target instanceof Element) || e.target.closest(NOT_INTERACTION)) return;
    if (e.target.closest(PRESSABLE)) report();
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector(NOT_INTERACTION)) return;
    if (!MODIFIER_KEYS.has(e.key)) report();
  };
  function stop() {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  return stop;
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
    looked: report.looked,
    report_number: report.reportNumber,
    ...visitDimensions(),
  }, idleHintArmProps());
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
  send("leaderboard_opened", { from, puzzle_date: todayDateString() });
  markLooked("leaderboard");
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
  send("found_words_opened", { from, puzzle_date: todayDateString() });
  markLooked("found_words");
}

/**
 * The chat room, in four events. Every one carries the live `puzzle_date`, so
 * the report counts chat per puzzle the way it counts everything else, and
 * `player_id` rides along from `mirror` -- which is what makes distinct viewers
 * and senders countable at all.
 *
 * `view_id` is one opening of the panel, and groups `chat_time`'s reports the
 * way `session_id` groups `session_time`'s: a view that is backgrounded and
 * picked up again reports more than once, `visible_ms` is its running total,
 * `segment_ms` is only the new part, so `max(visible_ms)` per view is its
 * length. Kept apart from `markLooked`: chatting is its own kind of visit, and
 * folding it into "engaged" would move every existing number on the page.
 */
export function trackChatOpened(viewId: string) {
  send("chat_opened", { view_id: viewId, puzzle_date: todayDateString() });
}

export function trackChatTime(report: {
  viewId: string;
  visibleMs: number;
  segmentMs: number;
  sent: number;
  closed: boolean;
  reportNumber: number;
}) {
  send("chat_time", {
    view_id: report.viewId,
    visible_ms: report.visibleMs,
    segment_ms: report.segmentMs,
    sent: report.sent,
    closed: report.closed,
    report_number: report.reportNumber,
    puzzle_date: todayDateString(),
  });
}

/** A message that reached the room. Its length, never its text. */
export function trackChatMessageSent(viewId: string, length: number) {
  send("chat_message_sent", { view_id: viewId, length, puzzle_date: todayDateString() });
}

/** A send the room refused, and why -- the bubble's own check or the server's. */
export function trackChatMessageBlocked(
  viewId: string,
  reason: "too-long" | "profane" | "rate-limited" | "unavailable",
) {
  send("chat_message_blocked", { view_id: viewId, reason, puzzle_date: todayDateString() });
}

/**
 * Opening either page counts as engaging, for the visit and for the session,
 * so a player who only checks the boards or reads the finds is no longer
 * indistinguishable from one who opened the tab and left.
 *
 * Both open events carry `puzzle_date` -- the live puzzle, which is the one the
 * boards and the finds are about -- so the report can count, per puzzle, the
 * players who looked without banking a word (see analytics_report).
 */
function markLooked(via: "leaderboard" | "found_words"): void {
  markLook();
  const engaged = markSessionEngaged();
  if (engaged) trackVisitEngaged(engaged, via);
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
export function trackModeChanged(
  from: GameMode,
  to: GameMode,
  /** Which control: the header's switch, or the mode chip on the guess log. */
  via: "header" | "guess_log" = "header"
) {
  send("mode_changed", { from, to, via, puzzle_date: todayDateString() });
}

/**
 * What became of a tap on a guess log word's "Copy to <other mode>" control
 * (see game/crossMode.ts).
 *
 * One event per tap, whatever happened, so how often the control is reached
 * for and how often it lands are both answerable: `copied` is a word banked in
 * the other mode, `refused` a word that mode would not take, `full` a tap on a
 * puzzle with no guess left over there, and `lookup_failed` a live check that
 * could not answer. `copy_report` reads the event for /analytics, and joins it
 * to the board by `player_id` for the retention of the players who copy.
 *
 * Both scores ride along, so the question the feature exists to answer -- does
 * the same word pay better over there -- is readable straight off the log.
 */
export function trackAnswerCopied(details: {
  date: string;
  isToday: boolean;
  from: GameMode;
  to: GameMode;
  word: string;
  outcome: "copied" | "refused" | "full" | "lookup_failed";
  scoreFrom: number;
  scoreTo: number | null;
  /** Words banked in the other mode after the tap. */
  answerCount: number;
  reason?: RejectionReason;
}) {
  send("answer_copied", {
    puzzle_date: details.date,
    puzzle_number: puzzleNumber(details.date),
    live: details.isToday,
    from: details.from,
    to: details.to,
    word: details.word,
    outcome: details.outcome,
    score_from: details.scoreFrom,
    score_to: details.scoreTo,
    answer_count: details.answerCount,
    reason: details.reason ?? null,
  });
}

export function trackLeaderboardJoined(isRename: boolean) {
  send("leaderboard_joined", { rename: isRename });
}

/** Convert compact share-link codes into analytics campaign sources. */
export function campaignSourceFromSearch(search: string): "share" | "twitter" | "reddit" | null {
  // `sh.f` is a share link with its mode on (see game/onboarding.ts).
  const code = parseSourceCode(new URLSearchParams(search).get("s")).base;
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  if (code === "r") return "reddit";
  return null;
}

/**
 * The idle hint experiment (see game/idleHint.ts), in four events, all to both
 * sinks. Each carries `experiment` (`new` or `returning`) and `variant`
 * (`control` or `treatment`), and `player_id` rides along from `mirror`, which
 * is what `idle_hint_report` joins every later play, share and return to.
 *
 * - `idle_hint_assigned`: the draw, once per player per experiment.
 * - `idle_hint_triggered`: the box sat empty for the experiment's delay. Sent
 *   by both arms -- `shown` says whether anything appeared -- so the players
 *   who sat idle can be compared arm against arm. Carries the word that was (or,
 *   in control, would have been) hinted first, and the rotation that follows it.
 * - `idle_hint_typed`: the first keystroke after the trigger, which ends the
 *   loop, and how long it took to come.
 * - `idle_hint_word_submitted`: the player submitted a word the loop had
 *   reached. Sent by
 *   control too, which is the baseline: how often somebody plays that word
 *   without being told to.
 */
function idleHintProps(arm: IdleHintArm, date: string) {
  return {
    experiment: arm.experiment,
    variant: arm.variant,
    delay_ms: IDLE_HINT_DELAY_MS[arm.experiment],
    puzzle_date: date,
    puzzle_number: puzzleNumber(date),
    // The live puzzle, which is the day the visit, the session and any share
    // are counted on -- the played one can be an archived puzzle.
    live_date: todayDateString(),
  };
}

/**
 * The arm the session is in, for the mirror alone, on the events the key
 * numbers are made of (answers, completions, shares, session time) -- so the
 * log can be split by arm without a join. Vercel never sees these: it keeps
 * few properties, and the experiment's report is read from Supabase.
 */
function idleHintArmProps(): EventProps {
  const arm = currentIdleHintArm();
  return {
    idle_hint_experiment: arm?.experiment ?? null,
    idle_hint_variant: arm?.variant ?? null,
  };
}

export function trackIdleHintAssigned(arm: IdleHintArm, date: string) {
  send("idle_hint_assigned", { ...idleHintProps(arm, date), mode: modeOf(date) });
}

export function trackIdleHintTriggered(
  arm: IdleHintArm,
  date: string,
  words: readonly AcceptedWord[],
  answerCount: number
) {
  const [word] = words;
  send("idle_hint_triggered", {
    ...idleHintProps(arm, date),
    mode: modeOf(date),
    shown: arm.variant === "treatment",
    word: word.word,
    // The whole rotation, in order; `word` is the first of it.
    words: words.map((w) => w.word).join(","),
    rarity: word.rarity,
    score: rarityScore(word.zipf, date),
    answer_count: answerCount,
  });
}

export function trackIdleHintTyped(arm: IdleHintArm, date: string, msAfterTrigger: number) {
  send("idle_hint_typed", {
    ...idleHintProps(arm, date),
    ms_after_trigger: Math.round(msAfterTrigger),
  });
}

export function trackIdleHintWordSubmitted(
  arm: IdleHintArm,
  date: string,
  word: string,
  accepted: boolean
) {
  send("idle_hint_word_submitted", { ...idleHintProps(arm, date), word, accepted });
}
