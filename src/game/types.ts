export type Rarity =
  /** Retired at NARROW_BANDS_START -- reachable only on archived puzzles. */
  | "Quotidian"
  | "Very Common"
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Extremely Rare"
  | "Epic"
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

/** Persisted per calendar date in localStorage. */
export interface DailyProgress {
  date: string; // YYYY-MM-DD
  drop: string;
  acceptedWords: AcceptedWord[];
  rejectedAttempts: string[];
  completed: boolean;
  /** Whether this completed puzzle met the Rare-or-better win condition. */
  won?: boolean;
  completedAt?: string; // ISO timestamp
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
}
