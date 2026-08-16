import { track } from "@vercel/analytics";
import { rarityScore, type BaseFormSubstitution } from "./game/dictionary";
import { bestWord } from "./game/rank";
import { puzzleNumber } from "./game/share";
import type { AcceptedWord, DailyProgress, RejectionReason, StreakState } from "./game/types";
import type { VisitOutcome } from "./game/visits";

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

/** Record a successful copy from the standard Share button. */
export function trackResultCopied() {
  track("result_copied");
}

/** Record a click on the X share button. */
export function trackResultSharedOnX() {
  track("result_shared_on_x");
}

/** Record visitors who arrive through an X share link. */
export function trackTwitterArrival() {
  track("arrived_from_twitter");
}

/** Record visitors who arrive through a copied Share link. */
export function trackShareArrival() {
  track("arrived_from_share");
}

/** Map compact arrival codes to readable analytics source labels. */
function visitSource(code: string | null): string {
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  return code ?? "direct";
}

/** The shared dimensions carried by both visit events so they line up 1:1. */
function visitProperties(outcome: VisitOutcome) {
  return {
    visit_type: outcome.isFirstVisit ? "first" : "returning",
    source: visitSource(outcome.state.source),
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
export function campaignSourceFromSearch(search: string): "share" | "twitter" | null {
  const code = new URLSearchParams(search).get("s");
  if (code === "sh") return "share";
  if (code === "t") return "twitter";
  return null;
}
