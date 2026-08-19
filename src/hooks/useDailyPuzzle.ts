import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { puzzleNumber } from "../game/share";
import dropData from "../data/drops.json";
import {
  loadOrCreateProgress,
  loadStreak,
  lockInResult,
  recordAcceptedWord,
  recordRejectedAttempt,
  resetProgress,
} from "../game/storage";
import { evaluateSubmission, REJECTION_MESSAGES } from "../game/submit";
import {
  baseFormSubstitution,
  isUnattestedZipf,
  rarityForZipf,
  totalRarityScore,
  unattestedZipf,
} from "../game/dictionary";
import {
  checkWordLive,
  eligibleForLiveCheck,
  rejectionReasonForLive,
  shouldReportFailure,
  STILL_PENDING,
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
  trackBaseFormSubstitution,
  trackMerriamWebsterApproved,
  trackMerriamWebsterFailed,
  trackPuzzleCompleted,
  trackRejectedAnswer,
  trackRejectionMessage,
  trackUnattestedScore,
  trackVisitEngaged,
} from "../analytics";
import { markSessionEngaged } from "../game/visits";

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

  const showFeedback = useCallback((kind: Feedback["kind"], message: string, rarity?: Rarity) => {
    feedbackKey.current += 1;
    setFeedback({ kind, message, rarity, key: feedbackKey.current });
  }, []);

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
    (word: AcceptedWord, source: "curated" | "live"): boolean => {
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
      if (isUnattestedZipf(word.zipf)) trackUnattestedScore(viewedDate, word, source);
      const substitution = baseFormSubstitution(word.word, viewedDate);
      if (substitution) trackBaseFormSubstitution(viewedDate, substitution);
      if (updated.completed) {
        trackPuzzleCompleted(updated, "all_answers", updatedStreak);
      }
      showFeedback("accepted", `"${word.word}" accepted — ${word.rarity}.`, word.rarity);
      return true;
    },
    [viewedDate, showFeedback]
  );

  /** Record and report a rejection, and show its message. */
  const rejectWord = useCallback(
    (raw: string, reason: RejectionReason) => {
      const updated = recordRejectedAttempt(progressRef.current, raw.trim());
      progressRef.current = updated;
      setProgress(updated);
      trackRejectedAnswer(viewedDate, drop, raw);
      trackRejectionMessage(viewedDate, reason);
      showFeedback("rejected", REJECTION_MESSAGES[reason]);
    },
    [viewedDate, drop, showFeedback]
  );

  /**
   * Apply a live verdict: bank the word when MW approves it, otherwise fall
   * through to the rejection it earned. A failed lookup is reported as a failure
   * and draws no conclusion about the word -- the offline rejection stands.
   */
  const applyLiveCheck = useCallback(
    (raw: string, check: LiveCheck): SubmissionResult => {
      if (liveNotePending.current) {
        const settled =
          check.outcome === "playable" ? LIVE_CHECK_SETTLED.found : LIVE_CHECK_SETTLED.notFound;
        setLiveNote(settled);
      }

      if (check.outcome === "playable") {
        const info = liveRarity(check, viewedDate);
        const word: AcceptedWord = { word: check.word, ...info };
        const applied = acceptWord(word, "live");
        trackMerriamWebsterApproved(viewedDate, drop, check, info, applied);
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
      const reason = rejectionReasonForLive(check);
      rejectWord(raw, reason);
      return { ok: false, reason };
    },
    [viewedDate, drop, acceptWord, rejectWord]
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
        rejectWord(raw, reason);
        return result;
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
      showFeedback("rejected", REJECTION_MESSAGES[reason]);
      void lookup.then((late) => applyLiveCheck(raw, late));
      return result;
    },
    [drop, viewedDate, acceptWord, rejectWord, applyLiveCheck, showFeedback]
  );

  /** Player-initiated early finish: bank the best word(s) so far instead of using all 6 guesses. */
  const lockIn = useCallback(() => {
    const updated = lockInResult(progressRef.current);
    progressRef.current = updated;
    setProgress(updated);
    const updatedStreak = loadStreak();
    if (updated.won) setStreak(updatedStreak);
    if (updated.completed && !progress.completed) {
      trackPuzzleCompleted(updated, "locked_in", updatedStreak);
    }
  }, [progress.completed]);

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
    lockIn,
    resetAnswers,
    liveNote,
    checking,
  };
}
