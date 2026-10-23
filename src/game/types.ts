import type { GameMode } from "./mode";

export type Rarity =
  /** Retired at NARROW_BANDS_START -- reachable only on archived puzzles. */
  | "Quotidian"
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Extremely Rare"
  | "Elusive"
  | "Mythic"
  | "Legend";

export interface RarityInfo {
  zipf: number;
  rarity: Rarity;
}

/** A word the player has successfully submitted this puzzle. */
export interface AcceptedWord {
  word: string;
  rarity: Rarity;
  zipf: number;
}

/** Why a submission was rejected, for user-facing feedback. */
export type RejectionReason =
  | "empty"
  | "missing-drop"
  | "same-as-drop"
  | "not-a-word"
  | "proper-noun"
  | "abbreviation"
  | "name-or-abbreviation"
  | "misspelling"
  | "obsolete"
  | "archaic"
  | "dated"
  | "already-used"
  | "same-root-as-used"
  /** Nowhere to be found, but a letter or two from something playable. */
  | "check-your-spelling";

export interface SubmissionResult {
  ok: boolean;
  reason?: RejectionReason;
  word?: AcceptedWord;
}

/** Persisted per calendar date -- and, from MODE_CHOICE_START, per mode -- in
 * localStorage. */
export interface DailyProgress {
  date: string; // YYYY-MM-DD
  drop: string;
  /**
   * Which rules this day was played under (see game/mode.ts).
   *
   * Absent on every puzzle saved before the switch existed, which reads as the
   * mode that date's calendar decided: Standard for anything before the trial
   * week, Freeform inside it. Present from MODE_CHOICE_START on, because from
   * there the date no longer answers the question.
   *
   * Carried on the record as well as in the key so a save that is passed around
   * -- to the leaderboard's history import, to a submission in flight -- keeps
   * saying which board it belongs on.
   */
  mode?: GameMode;
  acceptedWords: AcceptedWord[];
  rejectedAttempts: string[];
  completed: boolean;
  /** Whether this completed puzzle met the Rare-or-better win condition. */
  won?: boolean;
  completedAt?: string; // ISO timestamp
  /**
   * Whether this puzzle's one retry has been spent (see storage.retryWord).
   *
   * One per puzzle, and only ever set -- a retried word is gone for good, and
   * the slot it gives back can only be spent on a new guess.
   *
   * Absent on every puzzle saved before this field existed, which reads as an
   * unspent retry. That is deliberate: those are archive puzzles by now, and the
   * retry is offered on the current puzzle only, so the unspent flag is never
   * reachable on them.
   */
  retryUsed?: boolean;
  /**
   * When the first word was accepted, as an ISO timestamp.
   *
   * The only record of when a puzzle was actually *played*, as opposed to
   * finished: `completedAt` is set on the last guess or the lock-in, and a day
   * left half-played never gets one at all. The leaderboard's history import
   * needs to know a puzzle was played on its own day rather than pulled out of
   * the archive later, and this is the evidence for it.
   *
   * Absent on every puzzle saved before this field existed, and on a day with no
   * accepted words. Readers fall back to `completedAt` (see
   * storage.playedOnItsDay).
   */
  firstWordAt?: string; // ISO timestamp
}

/** Saved freezes out of the most the streak could hold. */
export interface FreezeCount {
  banked: number;
  cap: number;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate?: string; // YYYY-MM-DD
  totalCompleted: number;
  crushedIt: number;
  elite: number;
  /** Highest rarity score earned from any accepted word. */
  highScore: number;
  /**
   * Recent days a streak freeze covered (see game/streakFreeze.ts), so a
   * covered day is never counted as played. Older saves may also carry a
   * `freezes` count from when freezes were earned; it is no longer read.
   */
  frozenDates?: string[];
  /**
   * Saved freezes, earned by a long streak and spent on missed days (see
   * game/streakFreeze.ts). Absent means none.
   */
  bankedFreezes?: number;
  /**
   * Saved freezes and the cap as they stood at the end of each recent day the
   * streak was played or covered, so a past puzzle shows the freezes held on
   * its day rather than today's (see `freezesOn` in game/streakFreeze.ts).
   */
  freezeHistory?: Record<string, FreezeCount>;
  /**
   * Set once the streak has been given the saved freezes it would have earned
   * had freezes existed before 2026-10-15 (see `backdateFreezes`).
   */
  freezesBackdated?: true;
  /**
   * The last day a welcome-back freeze was given to a returning player's new
   * streak (see `welcomeBack` in game/streakFreeze.ts), which spaces them out.
   */
  welcomeBackFreezeDate?: string;
}
