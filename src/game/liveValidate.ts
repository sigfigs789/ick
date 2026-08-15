import type { RejectionReason } from "./types";

// Reasons the /api/validate endpoint can return that map to a more specific
// client rejection message than the generic "not in the curated list".
const TAG_REASONS = new Set<RejectionReason>([
  "proper-noun",
  "abbreviation",
  "name-or-abbreviation",
  "obsolete",
  "archaic",
  "dated",
]);

export interface LiveValidation {
  /** True when Merriam-Webster attests an ordinary, current sense of the word. */
  valid: boolean;
  /** A specific reason when MW disqualified the word (proper noun, archaic, …). */
  reason: RejectionReason | null;
}

/**
 * Ask the server-side Merriam-Webster fallback (`/api/validate`) whether a word
 * the offline dictionary rejected is nonetheless a real, ordinary, current
 * English word. The MW keys live only in the serverless function, never here.
 *
 * Returns null whenever the fallback has no usable opinion -- not configured,
 * offline, a network error, or a malformed response -- so the caller can quietly
 * keep the original "not in the curated list" result.
 */
export async function liveValidateWord(word: string): Promise<LiveValidation | null> {
  let response: Response;
  try {
    response = await fetch(`/api/validate?word=${encodeURIComponent(word)}`);
  } catch {
    return null;
  }
  if (!response.ok) return null; // 400 malformed / 502 unavailable / 503 unconfigured
  let data: { valid?: unknown; reason?: unknown };
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (data.valid === true) return { valid: true, reason: null };
  const reason =
    typeof data.reason === "string" && TAG_REASONS.has(data.reason as RejectionReason)
      ? (data.reason as RejectionReason)
      : null;
  return { valid: false, reason };
}
