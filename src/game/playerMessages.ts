/**
 * Whether this host takes what players write: the chat room, the word
 * suggestion box, and the feedback notes.
 *
 * True on the website and in the app. False inside a Reddit post, for the same
 * reason reporting is off there (see `setReporting` in src/analytics.ts): every
 * one of them lands in the website's own Supabase -- chat through `/api/chat`,
 * suggestions and notes as mirrored events through `/api/events` -- and that
 * build serves neither path and sends nothing about a Reddit player off Reddit.
 * Left on, the boxes would still empty and still say "Thanks", having sent the
 * words nowhere. A post's own comments are where Reddit's players talk.
 *
 * Off means not shown, rather than shown and quietly dropped.
 */
let taking = true;

/** Stop showing the places a player writes to us. Call before rendering. */
export function setPlayerMessages(enabled: boolean): void {
  taking = enabled;
}

/** Whether the chat room, the suggestion box and the feedback notes are shown. */
export function takesPlayerMessages(): boolean {
  return taking;
}
