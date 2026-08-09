export type Rarity =
  | "Very Common"
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Extremely Rare";

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
  | "too-short"
  | "missing-fragment"
  | "not-a-word"
  | "already-used"
  | "same-root-as-used";

export interface SubmissionResult {
  ok: boolean;
  reason?: RejectionReason;
  word?: AcceptedWord;
}

/** Persisted per calendar date in localStorage. */
export interface DailyProgress {
  date: string; // YYYY-MM-DD
  fragment: string;
  acceptedWords: AcceptedWord[];
  rejectedAttempts: string[];
  completed: boolean;
  completedAt?: string; // ISO timestamp
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate?: string; // YYYY-MM-DD
  totalCompleted: number;
}
