import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayDateString } from "../game/date";
import { dropForDate } from "../game/drop";
import { maxGuessesFor, retryAvailableFor } from "../game/constants";
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
  playedOnItsDay,
  rescoreAcceptedWords,
} from "../game/storage";
import {
  consultsCorpus,
  evaluateSubmission,
  REJECTION_MESSAGES,
  spellingNearMiss,
} from "../game/submit";
import {
  baseFormSubstitution,
  isUnattestedZipf,
  rarityForZipf,
  totalRarityScore,
  unattestedZipf,
  usesFreeformRules,
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
  trackAnswerCopied,
  trackAnswerRetried,
  trackAnswerRevealed,
  trackBaseFormSubstitution,
  trackMerriamWebsterApproved,
  trackMerriamWebsterFailed,
  trackPuzzleCompleted,
  trackRejectedAnswer,
  trackRejectionMessage,
  trackUnattestedScore,
  trackEstimatedScore,
  scoreSource,
  trackVisitEngaged,
} from "../analytics";
import { backfillHistory, submitScore } from "../game/leaderboard";
import { fetchLiveFoldRejections } from "../game/liveFoldRejections";
import {
  liveFoldRescore,
  markNoticesSeen,
  unseenNotices,
  type LiveFoldNotice,
} from "../game/liveFoldRescore";
import { loadPlayerId } from "../game/player";
import { reportBankedWord } from "../game/chatNotices";
import { setViewedPuzzle } from "../game/viewedPuzzle";
import { markSessionEngaged } from "../game/visits";
import { markGuess } from "../game/sessionTime";
import { asMode, MODE_LABELS, modeIsChosen, otherMode } from "../game/mode";
import {
  crossModeAvailable,
  loadProgressInMode,
  previewInMode,
  scoreInMode,
  type CrossModePreview,
} from "../game/crossMode";
import { useGameMode } from "./useGameMode";

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
  // Read rather than set here: the switch lives in the header (see
  // components/ModeToggle.tsx). What this subscription buys is a re-render when
  // it moves, which is what reloads the day's progress from the other mode's key
  // and reprices every word on screen.
  const [mode] = useGameMode();
  const drop = useMemo(() => dropForDate(viewedDate), [viewedDate]);
  // The chat opens on whichever puzzle is on screen (see game/viewedPuzzle.ts).
  useEffect(() => setViewedPuzzle(viewedDate), [viewedDate]);
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

  // The same puzzle's game in the other mode, read so the guess log can show
  // what each word would score over there and copy it across (see
  // game/crossMode.ts). Reloaded with this mode's progress, below.
  const target = otherMode(mode);
  const [otherProgress, setOtherProgress] = useState<DailyProgress>(() =>
    loadProgressInMode(viewedDate, drop, target)
  );
  // The word being copied right now, so its control can say so and a second
  // tap during a live lookup cannot bank it twice.
  const [copying, setCopying] = useState<string | null>(null);
  const copyingRef = useRef<string | null>(null);

  // Words with a live lookup in flight, so re-submitting one mid-flight can't
  // start a second lookup or bank the same word twice.
  const inFlight = useRef<Set<string>>(new Set());

  // Every puzzle from the trial week on plays off the expansive corpus as well
  // as the curated list, so start fetching it as soon as one is in view.
  // Nothing waits on it: until it arrives submissions fall through to the live
  // lookup exactly as they always have, and a failed fetch is not surfaced
  // because a player on a bad connection still has a full game without it.
  //
  // It used to be freeform's alone, on the argument that an ordinary puzzle
  // never consults it and so should never pay the 3.6MB. Both modes consult it
  // now (see corpusVerdict in submit.ts), so both fetch it -- and the cost is
  // the same download in either mode, once, cached by version. Archive puzzles
  // before the trial still never ask for it.
  useEffect(() => {
    if (consultsCorpus(viewedDate)) void loadCorpus();
  }, [viewedDate, mode]);

  // Reload whenever the viewed puzzle changes (browsing the archive) or the mode
  // does -- each date's progress is saved independently per mode (see
  // storage.ts), so switching back to a puzzle you had already started resumes
  // it, and flipping the switch opens that day's other game with its own
  // untouched set of guesses.
  useEffect(() => {
    const loaded = loadOrCreateProgress(viewedDate, drop);
    progressRef.current = loaded;
    setProgress(loaded);
    setOtherProgress(loadProgressInMode(viewedDate, drop, otherMode(mode)));
    setFeedback(null);
    setLiveNote(null);
    setChecking(false);
  }, [viewedDate, drop, mode]);

  // Folds rejected live at /folded-live on this puzzle (see
  // game/liveFoldRejections.ts). Asked for on every open of a puzzle, and never
  // waited on: until the answer lands the game plays exactly as it did, and a
  // failed read leaves the scores the player already had. When it lands, any
  // word of theirs it names is priced again on its own frequency, saved, sent
  // to the board, and owed a bubble saying why it moved.
  const [foldNotices, setFoldNotices] = useState<LiveFoldNotice[]>([]);
  useEffect(() => {
    setFoldNotices([]);
    if (usesFreeformRules(viewedDate, mode)) return;
    let cancelled = false;
    fetchLiveFoldRejections(viewedDate)
      .then(async (rejections) => {
        if (rejections.length === 0) return;
        // A corpus word is priced off the corpus, so it has to be there first.
        if (consultsCorpus(viewedDate)) await loadCorpus();
        const before = progressRef.current;
        if (cancelled || before.date !== viewedDate) return;
        const { rescored, notices } = liveFoldRescore(before);
        const updated = rescoreAcceptedWords(before, rescored);
        if (updated !== before) {
          progressRef.current = updated;
          setProgress(updated);
          setStreak(loadStreak());
          // A rejected fold only ever raises a word, and the board keeps the
          // higher score, so re-sending the day is all it takes. Today's goes
          // the usual way; an earlier day only if it was played on its own day,
          // which is the only kind of day the board ever counted.
          const playerId = loadPlayerId();
          if (viewedDate === today) {
            submitScore({
              date: viewedDate,
              isToday: true,
              words: updated.acceptedWords,
              mode: updated.mode,
              retried: updated.retryUsed === true,
            });
          } else if (
            playerId &&
            playedOnItsDay().some((p) => p.date === viewedDate && p.mode === updated.mode)
          ) {
            backfillHistory(playerId, [updated], today);
          }
        }
        setFoldNotices(unseenNotices(viewedDate, notices));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewedDate, mode, today]);

  const dismissFoldNotices = useCallback(() => {
    markNoticesSeen(viewedDate, foldNotices);
    setFoldNotices([]);
  }, [viewedDate, foldNotices]);

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
        // Off the record rather than off the switch: a live lookup can settle
        // after the player has flipped it, and the word belongs to the game it
        // was submitted to.
        mode: updated.mode,
        // Which side of the retry this account of the day comes from. The board
        // is monotonic per day, so this is what lets the first word banked after
        // a retry bring the day down to what the player actually holds.
        retried: updated.retryUsed === true,
      });
      // And to the chat room, which announces a puzzle's new 7.0+ top score and
      // any 9.5+ word. The same fire-and-forget write, for the live puzzle only.
      reportBankedWord({
        date: viewedDate,
        isToday: viewedDate === today,
        word,
        mode: updated.mode,
      });
      if (isUnattestedZipf(word.zipf)) trackUnattestedScore(viewedDate, word, source);
      if (scoreSource(viewedDate, word) === "estimated") trackEstimatedScore(viewedDate, word);
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
   * What archive play does not get is a board correction. The leaderboard ranks
   * today's puzzle only (see leaderboard.submitScore) -- an archive day is sent
   * for the finds feed alone -- so an archive retry changes what this browser
   * remembers and no board row.
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
      // Archive play leaves the board alone: `submitScore` sends an old day
      // unranked, so retrying a word on it corrects this browser's record and
      // no board row. (The feed keeps the word -- it was found.)
      submitScore({
        date: viewedDate,
        isToday,
        words: updated.acceptedWords,
        retried: true,
        mode: updated.mode,
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

  /**
   * What every banked word would be in the other mode, keyed by word, for the
   * guess log. Empty on a puzzle from before the choice date, which has only
   * the one game.
   */
  const crossMode = useMemo<Record<string, CrossModePreview>>(() => {
    if (!crossModeAvailable(viewedDate)) return {};
    const previews: Record<string, CrossModePreview> = {};
    for (const word of progress.acceptedWords) {
      previews[word.word] = previewInMode(word, target, viewedDate, drop, otherProgress);
    }
    return previews;
  }, [progress.acceptedWords, otherProgress, target, viewedDate, drop]);

  /**
   * Bank one of this game's words in the other mode's game for the same
   * puzzle, without moving the switch (see game/crossMode.ts).
   *
   * A real submission over there: judged by that mode's rules, spending one of
   * its guesses, and sent to that mode's board -- what typing it there would
   * have done, minus the trip. The other game's progress is read fresh at the
   * moment of banking rather than trusted from the preview, because a live
   * lookup can take seconds and the other tab of this same browser can have
   * played meanwhile.
   *
   * Reported as `answer_copied` and not as `answer_accepted`: a copy is not a
   * guess, and counting it as one would inflate exactly the per-mode guess
   * numbers the copy is most likely to be compared against.
   */
  const copyToOtherMode = useCallback(
    async (raw: string) => {
      if (!crossModeAvailable(viewedDate) || copyingRef.current) return;
      const source = progressRef.current.acceptedWords.find((w) => w.word === raw);
      if (!source) return;
      const to = otherMode(mode);
      const label = MODE_LABELS[to];
      const scoreFrom = scoreInMode(source, viewedDate, mode);
      const report = (
        outcome: "copied" | "refused" | "full" | "lookup_failed",
        answerCount: number,
        scoreTo: number | null,
        reason?: RejectionReason
      ) =>
        trackAnswerCopied({
          date: viewedDate,
          isToday,
          from: mode,
          to,
          word: source.word,
          outcome,
          scoreFrom,
          scoreTo,
          answerCount,
          reason,
        });

      let preview = previewInMode(source, to, viewedDate, drop, loadProgressInMode(viewedDate, drop, to));
      if (preview.state === "copied") return;
      if (preview.state === "full") {
        report("full", maxGuessesFor(viewedDate), null);
        showFeedback("rejected", `Your ${label} game for this puzzle is already finished.`);
        return;
      }
      if (preview.state === "refused") {
        report("refused", otherProgress.acceptedWords.length, null, preview.reason);
        showFeedback(
          "rejected",
          `${label} won't take "${source.word}": ${REJECTION_MESSAGES[preview.reason]}`,
          undefined,
          preview.reason
        );
        return;
      }

      copyingRef.current = source.word;
      setCopying(source.word);
      try {
        let word = preview.word;
        if (preview.needsLiveCheck) {
          const check = await checkWordLive(source.word);
          const waiver = asMode(to, () => waivedLiveRejection(check, viewedDate));
          if (check.outcome !== "playable" && waiver === undefined) {
            // "unknown" is an answer about the word; the rest are a lookup that
            // never got one, which says nothing about whether it would count.
            const failed = check.outcome !== "rejected" && check.outcome !== "unknown";
            const reason = rejectionReasonForLive(check);
            report(failed ? "lookup_failed" : "refused", otherProgress.acceptedWords.length, null, reason);
            showFeedback(
              "rejected",
              failed
                ? `Couldn't check "${source.word}" for ${label} just now. Try again in a moment.`
                : `${label} won't take "${source.word}": ${REJECTION_MESSAGES[reason]}`,
              undefined,
              reason
            );
            return;
          }
          word = { word: check.word, ...asMode(to, () => liveRarity(check, viewedDate)) };
        }

        // Re-read after the await: the other game may have moved meanwhile.
        const fresh = loadProgressInMode(viewedDate, drop, to);
        preview = previewInMode(source, to, viewedDate, drop, fresh);
        if (preview.state === "copied") return;
        if (preview.state !== "ready") {
          report(preview.state, fresh.acceptedWords.length, null);
          return;
        }
        const banked = asMode(to, () => recordAcceptedWord(fresh, word));
        if (banked === fresh) {
          report("full", fresh.acceptedWords.length, null);
          return;
        }
        setOtherProgress(banked);
        const updatedStreak = loadStreak();
        setStreak(updatedStreak);
        const scoreTo = scoreInMode(word, viewedDate, to);
        report("copied", banked.acceptedWords.length, scoreTo);
        // Onto the other mode's board, the same fire-and-forget write a word
        // typed there makes. Priced under that mode, since the submission
        // prices the words as it is called.
        asMode(to, () =>
          submitScore({
            date: viewedDate,
            isToday,
            words: banked.acceptedWords,
            mode: to,
            retried: banked.retryUsed === true,
          })
        );
        if (banked.completed) asMode(to, () => trackPuzzleCompleted(banked, updatedStreak));
        showFeedback(
          "accepted",
          `"${word.word}" submitted to ${label} — ${word.rarity}.`,
          word.rarity
        );
      } finally {
        copyingRef.current = null;
        setCopying(null);
      }
    },
    [mode, viewedDate, drop, isToday, otherProgress, showFeedback]
  );

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
    /** The rules this puzzle is being played under, for the copy that names them. */
    mode,
    /** Whether this puzzle is one the switch decides at all (see game/mode.ts). */
    modeChosen: modeIsChosen(viewedDate),
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
    /** The mode a word would be copied into, and what each word does there. */
    otherMode: target,
    crossMode,
    copying,
    copyToOtherMode,
    liveNote,
    checking,
    /** The player's words whose fold was rejected live, not yet acknowledged. */
    foldNotices,
    dismissFoldNotices,
  };
}
