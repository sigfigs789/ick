import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { retryAvailableFor } from "../game/constants";
import { puzzleNumber } from "../game/share";
import dropData from "../data/drops.json";
import {
  loadOrCreateProgress,
  loadStreak,
  recordAcceptedWord,
  recordRejectedAttempt,
  resetProgress,
  retryWord,
  forfeitRetry,
} from "../game/storage";
import { evaluateSubmission, REJECTION_MESSAGES, spellingNearMiss } from "../game/submit";
import {
  baseFormSubstitution,
  completeDictionaryActive,
  isFreeformWeek,
  isUnattestedZipf,
  rarityForZipf,
  totalRarityScore,
  unattestedZipf,
  waivedRejection,
} from "../game/dictionary";
import { loadCorpus } from "../game/corpus";
import {
  checkWordLive,
  eligibleForLiveCheck,
  rejectionReasonForLive,
  shouldReportFailure,
  STILL_PENDING,
  waivedLiveRejection,
  withHandoff,
  type LiveCheck,
} from "../game/liveValidate";
import type {
  AcceptedWord,
  DailyProgress,
  RarityInfo,
  Rarity,
  RejectionReason,
  StreakState,
  SubmissionResult,
} from "../game/types";
import {
  trackAcceptedAnswer,
  trackAnswerRetried,
  trackAnswerRevealed,
  trackBaseFormSubstitution,
  trackMerriamWebsterApproved,
  trackMerriamWebsterFailed,
  trackPuzzleCompleted,
  trackRejectedAnswer,
  trackRejectionMessage,
  trackUnattestedScore,
  trackVisitEngaged,
} from "../analytics";
import { submitScore } from "../game/leaderboard";
import { markSessionEngaged } from "../game/visits";
import { markGuess } from "../game/sessionTime";

/**
 * How the acceptance names a waived reason. Adjectives rather than the data's
 * own slugs, because the sentence they land in is about the word: "obsolete,
 * but accepted" reads as a remark, where "obsolete-word, but accepted" reads as
 * a database field.
 */
const WAIVED_LABELS: Record<string, string> = {
  obsolete: "obsolete",
  archaic: "archaic",
  dated: "dated",
};

/**
 * What the game says while a live lookup runs, and what it says once the lookup
 * has answered -- the same search moving from in-progress to done, so finishing
 * reads as a completed action rather than a message that simply stops.
 *
 * The in-progress line rotates; the settled ones don't. A player sees several
 * lookups over a week and a fixed line would read as a frozen message, but the
 * verdict is not the place for variety -- "Found it!" and "Not found" are the
 * two things there are to say, and saying them the same way every time is what
 * makes them legible at a glance.
 *
 * Every line reports on the *search*, never on the word: a word can be
 * perfectly good and still be one no reference here carries, so nothing here
 * claims a word is or isn't real. The toast is what delivers the verdict.
 *
 * None of them names a particular reference. "Dictionaries", "tomes" and "the
 * stacks" say work is being done and roughly where, without naming the fallback
 * and inviting players to fish for words the curated list doesn't have. A line
 * that skips the where ("Digging deeper…") is fine among lines that don't: the
 * rotation as a whole is what tells the player where the game has gone.
 */
export const LIVE_CHECK_PENDING: readonly string[] = [
  "Consulting the tomes…",
  "Digging deeper…",
  "Rifling through dictionaries…",
  "Off to the stacks…",
  "Blowing dust off the tomes…",
  "Thumbing the index…",
  "Down in the footnotes…",
  "Ransacking the dictionaries…",
  "Waking the librarian…",
];

/** Once the search has turned the word up, and once it has come back empty. */
export const LIVE_CHECK_SETTLED = {
  found: "Found it!",
  notFound: "Not found",
} as const;

// Advanced rather than randomised so two lookups in a row never show the same
// line (which would read as a frozen message) and so tests stay predictable.
let pendingIndex = 0;

/** The next in-progress line in the rotation. */
export function nextLiveCheckPending(): string {
  const line = LIVE_CHECK_PENDING[pendingIndex % LIVE_CHECK_PENDING.length];
  pendingIndex += 1;
  return line;
}

export interface Feedback {
  kind: "accepted" | "rejected";
  message: string;
  rarity?: Rarity;
  /**
   * Why a rejected guess was turned away, so the toast can tell a word the game
   * explained ("this is a proper noun") from one it simply doesn't carry.
   */
  reason?: RejectionReason;
  /** Bumped on every feedback event so screen readers re-announce repeats. */
  key: number;
}

/** The rarity a live-validated word is scored at: its measured frequency when a
 * source attests one, otherwise the unattested floor. */
function liveRarity(check: LiveCheck, date: string): RarityInfo {
  const zipf = check.zipf ?? unattestedZipf();
  return { zipf, rarity: rarityForZipf(zipf, date) };
}

export function useDailyPuzzle() {
  const today = useMemo(() => todayDateString(), []);
  const [viewedDate, setViewedDate] = useState(today);
  const drop = useMemo(() => dropForDate(viewedDate), [viewedDate]);
  const isToday = viewedDate === today;
  const canGoToPrevious = viewedDate > dropData.epoch;
  const canGoToNext = viewedDate < today;

  const [progress, setProgress] = useState<DailyProgress>(() =>
    loadOrCreateProgress(viewedDate, drop)
  );
  const [streak, setStreak] = useState<StreakState>(() => loadStreak());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackKey = useRef(0);
  // Set while a live lookup is running, then switched to its settled form once
  // the lookup answers. Deliberately not cleared on the verdict: the player
  // should see that the search finished, not watch a message blink out.
  const [liveNote, setLiveNote] = useState<string | null>(null);
  // True while this submission's note is up and still owed a settled form.
  const liveNotePending = useRef(false);
  // True only while the player is actually being made to wait on a lookup --
  // set when one starts, cleared the moment it answers or hands off at
  // LIVE_HANDOFF_MS. A lookup that outlives the handoff keeps running, but the
  // input stops advertising it: the player has already been given a verdict and
  // told to carry on, so a still-pulsing box would be claiming a wait that is
  // no longer theirs.
  const [checking, setChecking] = useState(false);

  // A live lookup can settle long after `submitWord` returned, so the bookkeeping
  // it does must read the newest progress rather than the value captured by the
  // closure that started it.
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Words with a live lookup in flight, so re-submitting one mid-flight can't
  // start a second lookup or bank the same word twice.
  const inFlight = useRef<Set<string>>(new Set());

  // Every puzzle from COMPLETE_DICTIONARY_START plays off the expansive corpus as
  // well as the curated list -- and freeform week did before it -- so start
  // fetching it as soon as such a puzzle is in view. Nothing waits on it: until
  // it arrives submissions fall through to the live lookup exactly as they always
  // have, and a failed fetch is not surfaced because a player on a bad connection
  // still has a full game without it.
  //
  // Only puzzles that consult it pay the 3.6MB, which now means the archive is
  // the exception rather than the rule: a puzzle from before either cutover never
  // asks the corpus anything, so it should never download it.
  useEffect(() => {
    if (isFreeformWeek(viewedDate) || completeDictionaryActive(viewedDate)) void loadCorpus();
  }, [viewedDate]);

  // Reload whenever the viewed puzzle changes (browsing the archive) --
  // each date's progress is saved independently (see storage.ts), so
  // switching back to a puzzle you'd already started resumes it.
  useEffect(() => {
    const loaded = loadOrCreateProgress(viewedDate, drop);
    progressRef.current = loaded;
    setProgress(loaded);
    setFeedback(null);
    setLiveNote(null);
    setChecking(false);
  }, [viewedDate, drop]);

  const showFeedback = useCallback(
    (kind: Feedback["kind"], message: string, rarity?: Rarity, reason?: RejectionReason) => {
      feedbackKey.current += 1;
      setFeedback({ kind, message, rarity, reason, key: feedbackKey.current });
    },
    []
  );

  /**
   * Bank an accepted word, fire its analytics, and show the acceptance. Returns
   * false when the puzzle had already finished (storage refuses further
   * changes), which only a late-arriving live verdict can hit.
   *
   * Every accepted word goes through here, so a word confirmed live reads
   * exactly like one from the curated list -- where it came from is analytics'
   * business, not the player's.
   */
  const acceptWord = useCallback(
    (word: AcceptedWord, source: "curated" | "live", liveWaiver?: RejectionReason): boolean => {
      const before = progressRef.current;
      const updated = recordAcceptedWord(before, word);
      if (updated === before) return false;
      progressRef.current = updated;
      setProgress(updated);
      const updatedStreak = loadStreak();
      setStreak(updatedStreak);
      trackAcceptedAnswer(
        viewedDate,
        word,
        updated.acceptedWords.length,
        totalRarityScore(updated.acceptedWords, viewedDate),
        updatedStreak.currentStreak
      );
      // Push the day's running score to the leaderboard, if this browser has a
      // name on it. Deliberately after the word is saved, rendered and tracked:
      // it is a fire-and-forget POST that nothing here waits on or checks, and a
      // submission that never lands costs the player a board position, never a
      // word. Sent per word rather than at the end so a player who wanders off
      // mid-puzzle still counts; the write keeps the higher score, so the
      // repeats are harmless.
      submitScore({
        date: viewedDate,
        isToday: viewedDate === today,
        words: updated.acceptedWords,
        // Which side of the retry this account of the day comes from. The board
        // is monotonic per day, so this is what lets the first word banked after
        // a retry bring the day down to what the player actually holds.
        retried: updated.retryUsed === true,
      });
      if (isUnattestedZipf(word.zipf)) trackUnattestedScore(viewedDate, word, source);
      const substitution = baseFormSubstitution(word.word, viewedDate);
      if (substitution) trackBaseFormSubstitution(viewedDate, substitution);
      if (updated.completed) {
        trackPuzzleCompleted(updated, updatedStreak);
      }
      // Freeform week lets a word in that its age would otherwise have kept out,
      // and says so: a player who reaches for "tabacco" and has it counted is
      // owed the reason it counted, which is also the week in miniature.
      //
      // Either waiver reads the same to the player, and has to: whether the word
      // was in our dictionary carrying a reviewed "obsolete" or came back
      // obsolete from Merriam-Webster is a fact about our data, not about their
      // word. The label lookup is what decides whether anything is said at all,
      // so a waiver with no adjective (a proper noun, an abbreviation) falls
      // through to the plain acceptance rather than printing an empty one.
      const waived = liveWaiver ?? waivedRejection(word.word, viewedDate);
      const label = waived ? WAIVED_LABELS[waived] : undefined;
      showFeedback(
        "accepted",
        label
          ? `"${word.word}" is ${label}, but accepted — ${word.rarity}.`
          : `"${word.word}" accepted — ${word.rarity}.`,
        word.rarity
      );
      return true;
    },
    [viewedDate, today, showFeedback]
  );

  /** Record and report a rejection, and show its message. */
  const rejectWord = useCallback(
    (raw: string, reason: RejectionReason) => {
      const updated = recordRejectedAttempt(progressRef.current, raw.trim());
      progressRef.current = updated;
      setProgress(updated);
      trackRejectedAnswer(viewedDate, drop, raw);
      trackRejectionMessage(viewedDate, reason);
      showFeedback("rejected", REJECTION_MESSAGES[reason], undefined, reason);
    },
    [viewedDate, drop, showFeedback]
  );

  /**
   * The reason to actually show once a guess has run out of places to be found.
   * A "not found" verdict on a word sitting a letter or two from a playable
   * answer is more often a typo than an invention, so it becomes the spelling
   * nudge instead of the flat "not in the curated list".
   *
   * Only for verdicts where the search came up empty. A word a reference *did*
   * find and the game still won't take (a proper noun, an offensive sense) is
   * spelled exactly as the player meant it, and telling them to check would be
   * sending them after a typo that isn't there.
   */
  const shownRejectionReason = useCallback(
    (raw: string, reason: RejectionReason): RejectionReason => {
      if (reason !== "not-a-word") return reason;
      const nearMiss = spellingNearMiss(raw, drop, progressRef.current.acceptedWords, viewedDate);
      return nearMiss ? "check-your-spelling" : reason;
    },
    [drop, viewedDate]
  );

  /**
   * Apply a live verdict: bank the word when MW approves it, otherwise fall
   * through to the rejection it earned. A failed lookup is reported as a failure
   * and draws no conclusion about the word -- the offline rejection stands.
   */
  const applyLiveCheck = useCallback(
    (raw: string, check: LiveCheck): SubmissionResult => {
      // A register verdict the week waives is a find, not a miss -- the search
      // did turn the word up, and the only thing that stood between the player
      // and the word was a rule this week does not apply. Saying "not found"
      // over a word about to be banked would be the sheet's promise and the
      // game's own note contradicting each other in the same breath.
      const liveWaiver = waivedLiveRejection(check, viewedDate);
      const found = check.outcome === "playable" || liveWaiver !== undefined;

      if (liveNotePending.current) {
        setLiveNote(found ? LIVE_CHECK_SETTLED.found : LIVE_CHECK_SETTLED.notFound);
      }

      if (found) {
        const info = liveRarity(check, viewedDate);
        const word: AcceptedWord = { word: check.word, ...info };
        const applied = acceptWord(word, "live", liveWaiver);
        trackMerriamWebsterApproved(viewedDate, drop, check, info, applied, liveWaiver ?? null);
        if (applied) return { ok: true, word };
        // Approved, but the puzzle finished while the lookup was in flight. The
        // submit form is gone by then, so there is nothing useful to say and no
        // new copy is invented -- the event records that it happened.
        return { ok: false, reason: "not-a-word" };
      }

      // A word that was approved is a success even if the other reference broke,
      // so nothing is reported there (see api/validate.ts). Anything else that
      // carries a failure is reported once per reason per session -- a dead key
      // would otherwise fire an identical event on every word.
      if (check.failure && shouldReportFailure(check.failure.reason)) {
        trackMerriamWebsterFailed(viewedDate, drop, check);
      }
      const verdict = rejectionReasonForLive(check);
      const reason = check.outcome === "rejected" ? verdict : shownRejectionReason(raw, verdict);
      rejectWord(raw, reason);
      return { ok: false, reason };
    },
    [viewedDate, drop, acceptWord, rejectWord, shownRejectionReason]
  );

  const submitWord = useCallback(
    async (raw: string): Promise<SubmissionResult> => {
      const result = evaluateSubmission(raw, drop, progressRef.current.acceptedWords, viewedDate);
      // Each submission starts from a clean slate; last guess's note is gone.
      setLiveNote(null);
      liveNotePending.current = false;

      // The first submission of a session marks this visit as engaged play
      // rather than an open-and-close, correlatable against site_visit volume.
      const engagedVisit = markSessionEngaged();
      if (engagedVisit) trackVisitEngaged(engagedVisit);
      // Marks the session clock: the first guess splits deciding from playing,
      // and each one after it moves the point where play last happened.
      markGuess();

      if (result.ok && result.word) {
        acceptWord(result.word, "curated");
        return result;
      }

      const reason = result.reason ?? "not-a-word";
      const word = raw.trim().toLowerCase();

      // Only a word that cleared every other rule and simply isn't on the
      // curated list is worth a live lookup. Everything else -- wrong drop,
      // already used, a reason the offline data already explains -- is final.
      const worthChecking =
        reason === "not-a-word" && eligibleForLiveCheck(word) && !inFlight.current.has(word);
      if (!worthChecking) {
        const shown = shownRejectionReason(raw, reason);
        rejectWord(raw, shown);
        return shown === reason ? result : { ...result, reason: shown };
      }

      inFlight.current.add(word);
      const lookup = checkWordLive(word);
      void lookup.then(
        () => inFlight.current.delete(word),
        () => inFlight.current.delete(word)
      );

      // Say so immediately. An unexplained pause is what reads as broken; a
      // stated one reads as work being done, which is why the wait can afford to
      // be as long as LIVE_HANDOFF_MS.
      liveNotePending.current = true;
      setLiveNote(nextLiveCheckPending());
      setChecking(true);
      const settled = await withHandoff(lookup);
      setChecking(false);
      if (settled !== STILL_PENDING) {
        return applyLiveCheck(raw, settled);
      }

      // Past the handoff window: stop making the player wait, but leave the
      // request running -- whatever it finds is still applied and still
      // reported, so a slow lookup costs the player nothing.
      const shownLate = shownRejectionReason(raw, reason);
      showFeedback("rejected", REJECTION_MESSAGES[shownLate], undefined, shownLate);
      void lookup.then((late) => applyLiveCheck(raw, late));
      return result;
    },
    [drop, viewedDate, acceptWord, rejectWord, applyLiveCheck, showFeedback, shownRejectionReason]
  );

  /**
   * Whether the puzzle's one retry is available to spend right now.
   *
   * The allowance belongs to the puzzle, not to the calendar: every day from
   * RETRY_START on carries one, and it is still there when that day becomes an
   * archive puzzle. Only the release date gates it, because only the release
   * date is a fact about how the puzzle was meant to play -- a day that dropped
   * before the feature existed never had a retry and does not get one now.
   *
   * What archive play does not get is a board correction. The leaderboard takes
   * today's puzzle only (see leaderboard.submitScore), so an archive retry
   * changes what this browser remembers and nothing that is already posted.
   */
  /**
   * The day's retry is still unspent, whether or not there is a word to
   * spend it on yet. Split out from `canRetry` below so the control can be
   * shown -- greyed out -- from the moment the puzzle opens, instead of
   * appearing out of nowhere once the first word lands (see GuessLog).
   */
  const retryOffered = retryAvailableFor(viewedDate) && !progress.retryUsed;
  const canRetry = retryOffered && progress.acceptedWords.length > 0;
  /** Spent, on a puzzle that was offering it -- so the UI can say so rather than
   * quietly withdrawing the control. Never true on a puzzle that dropped before
   * the feature, where the retry was never on offer in the first place. */
  const retrySpent = retryAvailableFor(viewedDate) && progress.retryUsed === true;
  /**
   * How many retries this puzzle has left, for the guess log's header counter.
   *
   * Null when the puzzle carries none at all -- one that dropped before the
   * feature started. That is a different thing from zero, which is a retry this
   * puzzle had and the player has spent, so the header can show a spent
   * allowance without inventing one for a day that never had it.
   *
   * Not derived from `canRetry`: the allowance is a fact about the puzzle from
   * the moment it opens, while `canRetry` also waits for a word worth taking
   * back. A player should see what they have before they have to spend it.
   */
  const retriesLeft: number | null = retryAvailableFor(viewedDate)
    ? progress.retryUsed
      ? 0
      : 1
    : null;

  /**
   * Spend the retry on a banked word: drop it and hand its guess back.
   *
   * Rechecks the puzzle's own allowance rather than trusting the caller: the
   * button is the only way in, but a puzzle can go stale under a tab left open
   * overnight, and this is the boundary that has to hold.
   */
  const retryAnswer = useCallback(
    (word: string) => {
      if (!retryAvailableFor(viewedDate)) return;
      const before = progressRef.current;
      const index = before.acceptedWords.findIndex((accepted) => accepted.word === word);
      const updated = retryWord(before, word);
      if (updated === before) return;
      progressRef.current = updated;
      setProgress(updated);
      setStreak(loadStreak());
      // Last guess's verdict belongs to a word that is no longer on the board.
      setFeedback(null);
      setLiveNote(null);
      liveNotePending.current = false;
      // Correct the board straight away rather than waiting for the replacement
      // word. The day's write is monotonic, so this is the submission that is
      // allowed to lower it (see the 20260831 migration) -- and a player who
      // takes a word back and then wanders off should not be left ranked on it.
      // Fire-and-forget like every other write here: nothing waits on it, and a
      // correction that never lands costs a board position, never a word.
      //
      // Archive play passes through untouched: `submitScore` takes today's
      // puzzle only, so retrying a word on an old day corrects this browser's
      // record and leaves the posted board alone.
      submitScore({
        date: viewedDate,
        isToday,
        words: updated.acceptedWords,
        retried: true,
      });
      trackAnswerRetried(
        viewedDate,
        before.acceptedWords[index],
        index,
        before.acceptedWords.length
      );
    },
    [isToday, viewedDate]
  );

  /**
   * Give up the retry to see the day's word (see DropDisplay).
   *
   * No word moves, so nothing is rolled back and the board is left alone --
   * the only change is that the retry is spent, which is what closes the door
   * on looking the answer up and then re-opening the puzzle to play it.
   *
   * Rechecks the allowance for the same reason `retryAnswer` does: a puzzle can
   * go stale under a tab left open overnight.
   */
  const revealAnswer = useCallback(() => {
    if (!retryAvailableFor(viewedDate)) return;
    const before = progressRef.current;
    const updated = forfeitRetry(before);
    if (updated === before) return;
    progressRef.current = updated;
    setProgress(updated);
    trackAnswerRevealed(viewedDate, before.acceptedWords.length);
  }, [viewedDate]);

  const resetAnswers = useCallback(() => {
    const fresh = resetProgress(viewedDate, drop);
    progressRef.current = fresh;
    setProgress(fresh);
    setFeedback(null);
    setLiveNote(null);
    setChecking(false);
  }, [viewedDate, drop]);

  const goToPrevious = useCallback(() => {
    setViewedDate((d) => (d > dropData.epoch ? addDays(d, -1) : d));
  }, []);

  const goToNext = useCallback(() => {
    setViewedDate((d) => (d < today ? addDays(d, 1) : d));
  }, [today]);

  const goToToday = useCallback(() => setViewedDate(today), [today]);

  return {
    date: viewedDate,
    puzzleNumber: puzzleNumber(viewedDate),
    isToday,
    canGoToPrevious,
    canGoToNext,
    goToPrevious,
    goToNext,
    goToToday,
    drop,
    progress,
    streak,
    feedback,
    submitWord,
    canRetry,
    retryOffered,
    retrySpent,
    retriesLeft,
    retryAnswer,
    revealAnswer,
    resetAnswers,
    liveNote,
    checking,
  };
}
