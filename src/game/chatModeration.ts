/**
 * Reporting and blocking in the chat room, shared by the website's bubble
 * (components/ChatBubble.tsx) and the app's chat sheet (native/).
 *
 * The App Store asks any app that shows what players write for a way to report
 * a message and a way to block whoever wrote it (Review Guideline 1.2). Both
 * work here without an account:
 *
 * - **Report** sends the line to api/chat.ts, which records it (see the
 *   20261105000000 migration) and takes the line out of the room for everybody
 *   once enough players have reported it. The reporter stops seeing it at once.
 * - **Block** is kept on this device: every line the blocked handle writes is
 *   left out of the room here, in every puzzle. A handle is computed from the
 *   player's id (see game/handle.ts), so it names the same player every time.
 *
 * Only a player's own words can be reported or blocked. The room's notices are
 * built from dictionary words by the server, and a player's own lines are
 * theirs.
 */

/** Handles this device has blocked, as a JSON array. */
export const CHAT_BLOCKED_KEY = "ick:chat-blocked";

/** Line ids this device has reported, as a JSON array; the newest are kept. */
export const CHAT_REPORTED_KEY = "ick:chat-reported";

/** Fired on window when the blocked or reported lists change. */
export const CHAT_MODERATION_EVENT = "ick:chat-moderation";

/** How many reported ids are kept; ids only grow, so the oldest go first. */
const REPORTED_KEPT = 500;

function readList(key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage refused: the block or report holds for nothing beyond this render.
  }
  try {
    window.dispatchEvent(new Event(CHAT_MODERATION_EVENT));
  } catch {
    // Nothing listening is the same as nothing to tell.
  }
}

/** The handles this device has blocked. */
export function blockedHandles(): ReadonlySet<string> {
  return new Set(readList(CHAT_BLOCKED_KEY).filter((h): h is string => typeof h === "string"));
}

export function blockHandle(handle: string): void {
  const list = [...blockedHandles()];
  writeList(CHAT_BLOCKED_KEY, list.includes(handle) ? list : [...list, handle]);
}

/** Lift every block on this device. */
export function unblockAll(): void {
  writeList(CHAT_BLOCKED_KEY, []);
}

/** The line ids this device has reported. */
export function reportedLines(): ReadonlySet<number> {
  return new Set(
    readList(CHAT_REPORTED_KEY).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id)),
  );
}

export function markReported(id: number): void {
  const list = [...new Set([...reportedLines(), id])].sort((a, b) => a - b).slice(-REPORTED_KEPT);
  writeList(CHAT_REPORTED_KEY, list);
}

/** What a line needs to say for moderation to judge it. */
interface Line {
  id: number;
  handle: string;
  kind?: string;
}

/** Whether `line` is a player's message somebody other than `ownHandle` wrote. */
export function canModerate(line: Line, ownHandle: string | null): boolean {
  return !line.kind && line.handle !== ownHandle;
}

/**
 * The room as this device shows it: without the lines it reported, or any
 * message from a handle it blocked. Notices stay, whoever they name.
 */
export function moderated<T extends Line>(
  lines: readonly T[],
  blocked: ReadonlySet<string> = blockedHandles(),
  reported: ReadonlySet<number> = reportedLines(),
): T[] {
  if (blocked.size === 0 && reported.size === 0) return [...lines];
  return lines.filter((line) => line.kind || (!blocked.has(line.handle) && !reported.has(line.id)));
}

/** Why a report did not go through, or "ok". */
export type ReportResult = "ok" | "missing" | "rate-limited" | "unavailable";

/**
 * Report line `id` in puzzle `date`'s room. The line is hidden here whatever
 * the server says -- the player asked not to see it -- and the answer only
 * says whether the report reached anybody.
 */
export async function reportLine(playerId: string, date: string, id: number): Promise<ReportResult> {
  markReported(id);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, date, report: { id } }),
    });
    if (response.ok) return "ok";
    const data = (await response.json().catch(() => ({}))) as { reason?: string };
    if (data.reason === "missing" || data.reason === "rate-limited") return data.reason;
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export const REPORT_RESULT_TEXT: Record<ReportResult, string> = {
  ok: "Reported. Thanks — we'll take a look.",
  // Already gone from the room, most likely because others reported it too.
  missing: "Reported. That message has already been removed.",
  "rate-limited": "Hidden for you. Too many reports at once — try again in a bit.",
  unavailable: "Hidden for you, but the report didn't send. Try again later.",
};

/**
 * Whether this device has agreed to the room's rules. The app asks once, before
 * its first chat opens: the App Store wants players to agree to terms that
 * leave no room for objectionable content before they can post or read it.
 */
export const CHAT_TERMS_KEY = "ick:chat-terms-accepted";

/** The rules a player agrees to, in the words the app shows them. */
export const CHAT_RULES: readonly string[] = [
  "Be kind. No harassment, hate, threats, sexual content or spam.",
  "Don't share personal details: yours or anybody else's.",
  "Hold a message to report it or block whoever wrote it.",
  "Reported messages are reviewed, and anyone who breaks these rules is removed.",
];

export function hasAcceptedChatTerms(): boolean {
  try {
    return localStorage.getItem(CHAT_TERMS_KEY) === "1";
  } catch {
    return false;
  }
}

export function acceptChatTerms(): void {
  try {
    localStorage.setItem(CHAT_TERMS_KEY, "1");
  } catch {
    // Asked again next time, which is the safe way round.
  }
}
