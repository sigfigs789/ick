import { siteUrl } from './net';

/**
 * The two things a player deliberately sends us: a word for the list, and a
 * note about the game.
 *
 * These go out even though this build reports nothing (see install.ts), and the
 * distinction is worth being precise about rather than glossing, because it is
 * the difference between telemetry and correspondence.
 *
 * Analytics is a record of what a player did, gathered because they played --
 * which word they guessed, how long they stayed, where they arrived from. They
 * did not ask for it to be sent and would not miss it if it were not. That is
 * what `setReporting(false)` switches off here, and it stays off.
 *
 * A word suggestion is the opposite: the player typed it into a box labelled
 * "Suggest a word" and pressed a button labelled "Suggest word", and the whole
 * point of the box is that the word reaches us. Dropping it silently while
 * answering "Thanks for the suggestion!" would be the app lying about what it
 * just did -- and the suggestion queue is how the dictionary actually grows, so
 * it is a real feature and not a leftover.
 *
 * They share `/api/events` as a transport because that is the endpoint the
 * website posts them to, and one queue for suggestions is the point of having
 * one. What is sent is exactly what the player typed and nothing else: no
 * device identifier, no player id, no puzzle, no session.
 *
 * Fire-and-forget, like every other write in this game: a suggestion that never
 * lands costs a word on a list, never a guess.
 */

function post(name: string, props: Record<string, string>): void {
  try {
    void fetch(siteUrl('/api/events'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, props }),
    }).catch(() => {});
  } catch {
    // Sending must never be able to break the screen the player is on.
  }
}

/** A word the player thinks belongs on the curated list. */
export function sendWordSuggestion(rawWord: string): void {
  const word = rawWord.trim().toLowerCase();
  if (!word) return;
  post('word_suggested', { word });
}

/** A note about the game, of whatever length the player wrote. */
export function sendFeedback(rawNote: string): void {
  const feedback = rawNote.trim();
  if (!feedback) return;
  post('feedback_submitted', { feedback });
}
